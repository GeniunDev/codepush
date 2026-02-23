// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as assert from "assert";
import * as express from "express";
import * as q from "q";
import * as redis from "redis";

import Promise = q.Promise;

export const DEPLOYMENT_SUCCEEDED = "DeploymentSucceeded";
export const DEPLOYMENT_FAILED = "DeploymentFailed";
export const ACTIVE = "Active";
export const DOWNLOADED = "Downloaded";

export interface CacheableResponse {
  statusCode: number;
  body: any;
}

export interface DeploymentMetrics {
  [labelStatus: string]: number;
}

export module Utilities {
  export function isValidDeploymentStatus(status: string): boolean {
    return status === DEPLOYMENT_SUCCEEDED || status === DEPLOYMENT_FAILED || status === DOWNLOADED;
  }

  export function getLabelStatusField(label: string, status: string): string {
    if (isValidDeploymentStatus(status)) {
      return label + ":" + status;
    } else {
      return null;
    }
  }

  export function getLabelActiveCountField(label: string): string {
    if (label) {
      return label + ":" + ACTIVE;
    } else {
      return null;
    }
  }

  export function getDeploymentKeyHash(deploymentKey: string): string {
    return "deploymentKey:" + deploymentKey;
  }

  export function getDeploymentKeyLabelsHash(deploymentKey: string): string {
    return "deploymentKeyLabels:" + deploymentKey;
  }

  export function getDeploymentKeyClientsHash(deploymentKey: string): string {
    return "deploymentKeyClients:" + deploymentKey;
  }
}

class PromisifiedRedisClient {
  // An incomplete set of promisified versions of the original redis methods
  public del: (...key: string[]) => Promise<number> = null;
  public execBatch: (redisBatchClient: any) => Promise<any[]> = null;
  public exists: (...key: string[]) => Promise<number> = null;
  public expire: (key: string, seconds: number) => Promise<number> = null;
  public hdel: (key: string, field: string) => Promise<number> = null;
  public hget: (key: string, field: string) => Promise<string> = null;
  public hgetall: (key: string) => Promise<any> = null;
  public hincrby: (key: string, field: string, value: number) => Promise<number> = null;
  public hset: (key: string, field: string, value: string) => Promise<number> = null;
  public ping: (payload?: any) => Promise<any> = null;
  public quit: () => Promise<void> = null;
  public select: (databaseNumber: number) => Promise<void> = null;
  public set: (key: string, value: string) => Promise<void> = null;

  constructor(redisClient: redis.RedisClient) {
    this.execBatch = (redisBatchClient: any) => {
      return q.ninvoke<any[]>(redisBatchClient, "exec");
    };

    for (const functionName in this) {
      if (this.hasOwnProperty(functionName) && (<any>this)[functionName] === null) {
        const originalFunction = (<any>redisClient)[functionName];
        assert(!!originalFunction, "Binding a function that does not exist: " + functionName);
        (<any>this)[functionName] = q.nbind(originalFunction, redisClient);
      }
    }
  }
}

export class RedisManager {
  private static DEFAULT_EXPIRY: number = 3600; // one hour, specified in seconds
  private static METRICS_DB: number = 1;

  private _opsClient: redis.RedisClient;
  private _promisifiedOpsClient: PromisifiedRedisClient;
  private _metricsClient: redis.RedisClient;
  private _promisifiedMetricsClient: PromisifiedRedisClient;
  private _setupMetricsClientPromise: Promise<void>;

  constructor() {
    if (process.env.REDIS_HOST && process.env.REDIS_PORT) {
      const redisConfig: any = {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT,
        auth_pass: process.env.REDIS_KEY,
        enable_offline_queue: true,
        retry_max_delay: 5000,
        max_attempts: 5,
      };

      if (process.env.REDIS_TLS === "true") {
        redisConfig.tls = {
          // Note: Node defaults CA's to those trusted by Mozilla
          rejectUnauthorized: true,
        };
      }
      this._opsClient = redis.createClient(redisConfig);
      this._metricsClient = redis.createClient(redisConfig);
      this._opsClient.on("error", (err: Error) => {
        console.error("Redis ops client error:", err.message);
      });

      this._metricsClient.on("error", (err: Error) => {
        console.error("Redis metrics client error:", err.message);
      });

      this._promisifiedOpsClient = new PromisifiedRedisClient(this._opsClient);
      this._promisifiedMetricsClient = new PromisifiedRedisClient(this._metricsClient);
      // setupMetricsClientPromise is now initialized lazily in ensureMetricsSetup
      this._setupMetricsClientPromise = null;
    } else {
      console.warn("No REDIS_HOST or REDIS_PORT environment variable configured.");
    }
  }

  private ensureMetricsSetup(): Promise<void> {
    if (!this.isEnabled) {
      return q.reject<void>(new Error("Redis manager is not enabled"));
    }

    if (this._setupMetricsClientPromise) {
      return this._setupMetricsClientPromise;
    }

    if (!this._metricsClient.ready) {
      return q.reject<void>(new Error("Redis metrics client is not ready"));
    }

    this._setupMetricsClientPromise = q(<void>null)
      .then(() => this._promisifiedMetricsClient.select(RedisManager.METRICS_DB))
      .then(() => this._promisifiedMetricsClient.set("health", "health"))
      .then(() => {})
      .catch((err) => {
        this._setupMetricsClientPromise = null; // Allow retry
        throw err;
      });

    return this._setupMetricsClientPromise;
  }

  public get isEnabled(): boolean {
    return !!this._opsClient && !!this._metricsClient;
  }

  public checkHealth(): Promise<void> {
    if (!this.isEnabled) {
      return q.reject<void>("Redis manager is not enabled");
    }

    return q.all([this._promisifiedOpsClient.ping(), this._promisifiedMetricsClient.ping()]).spread<void>(() => {});
  }

  private _safeCall<T>(
    client: redis.RedisClient,
    promisifiedClient: PromisifiedRedisClient,
    methodName: keyof PromisifiedRedisClient,
    ...args: any[]
  ): Promise<T> {
    if (!this.isEnabled || !client || !client.ready) {
      return q.reject<T>(new Error("Redis client is not ready"));
    }
    try {
      const func = promisifiedClient[methodName] as any;
      if (typeof func !== "function") {
        return q.reject<T>(new Error(`Redis method ${String(methodName)} is not promisified`));
      }
      return func(...args);
    } catch (err) {
      return q.reject<T>(err);
    }
  }

  /**
   * Get a response from cache if possible, otherwise return null.
   * @param expiryKey: An identifier to get cached response if not expired
   * @param url: The url of the request to cache
   * @return The object of type CacheableResponse
   */
  public getCachedResponse(expiryKey: string, url: string): Promise<CacheableResponse> {
    return this._safeCall<string>(this._opsClient, this._promisifiedOpsClient, "hget", expiryKey, url)
      .then((serializedResponse: string): Promise<CacheableResponse> => {
        if (serializedResponse) {
          const response = <CacheableResponse>JSON.parse(serializedResponse);
          return q<CacheableResponse>(response);
        } else {
          return q<CacheableResponse>(null);
        }
      })
      .catch(() => q<CacheableResponse>(null));
  }

  /**
   * Set a response in redis cache for given expiryKey and url.
   * @param expiryKey: An identifier that you can later use to expire the cached response
   * @param url: The url of the request to cache
   * @param response: The response to cache
   */
  public setCachedResponse(expiryKey: string, url: string, response: CacheableResponse): Promise<void> {
    // Store response in cache with a timed expiry
    const serializedResponse: string = JSON.stringify(response);
    let isNewKey: boolean;
    return this._safeCall<number>(this._opsClient, this._promisifiedOpsClient, "exists", expiryKey)
      .then((isExisting: number) => {
        isNewKey = !isExisting;
        return this._safeCall<number>(this._opsClient, this._promisifiedOpsClient, "hset", expiryKey, url, serializedResponse);
      })
      .then(() => {
        if (isNewKey) {
          return this._safeCall<number>(this._opsClient, this._promisifiedOpsClient, "expire", expiryKey, RedisManager.DEFAULT_EXPIRY);
        }
      })
      .then(() => {})
      .catch(() => {});
  }

  // Atomically increments the status field for the deployment by 1,
  // or 1 by default. If the field does not exist, it will be created with the value of 1.
  public incrementLabelStatusCount(deploymentKey: string, label: string, status: string): Promise<void> {
    const hash: string = Utilities.getDeploymentKeyLabelsHash(deploymentKey);
    const field: string = Utilities.getLabelStatusField(label, status);

    return this.ensureMetricsSetup()
      .then(() => this._safeCall<number>(this._metricsClient, this._promisifiedMetricsClient, "hincrby", hash, field, 1))
      .then(() => {})
      .catch(() => {});
  }

  public clearMetricsForDeploymentKey(deploymentKey: string): Promise<void> {
    return this.ensureMetricsSetup()
      .then(() =>
        this._safeCall<number>(
          this._metricsClient,
          this._promisifiedMetricsClient,
          "del",
          Utilities.getDeploymentKeyLabelsHash(deploymentKey),
          Utilities.getDeploymentKeyClientsHash(deploymentKey),
        ),
      )
      .then(() => {})
      .catch(() => {});
  }

  // Promised return value will look something like
  // { "v1:DeploymentSucceeded": 123, "v1:DeploymentFailed": 4, "v1:Active": 123 ... }
  public getMetricsWithDeploymentKey(deploymentKey: string): Promise<DeploymentMetrics> {
    return this.ensureMetricsSetup()
      .then(() =>
        this._safeCall<any>(
          this._metricsClient,
          this._promisifiedMetricsClient,
          "hgetall",
          Utilities.getDeploymentKeyLabelsHash(deploymentKey),
        ),
      )
      .then((metrics) => {
        // Redis returns numerical values as strings, handle parsing here.
        if (metrics) {
          Object.keys(metrics).forEach((metricField) => {
            if (!isNaN(metrics[metricField])) {
              metrics[metricField] = +metrics[metricField];
            }
          });
        }

        return <DeploymentMetrics>metrics;
      })
      .catch(() => q<DeploymentMetrics>(null));
  }

  public recordUpdate(
    currentDeploymentKey: string,
    currentLabel: string,
    previousDeploymentKey?: string,
    previousLabel?: string,
  ): Promise<void> {
    return this.ensureMetricsSetup()
      .then(() => {
        const batchClient: any = (<any>this._metricsClient).batch();
        const currentDeploymentKeyLabelsHash: string = Utilities.getDeploymentKeyLabelsHash(currentDeploymentKey);
        const currentLabelActiveField: string = Utilities.getLabelActiveCountField(currentLabel);
        const currentLabelDeploymentSucceededField: string = Utilities.getLabelStatusField(currentLabel, DEPLOYMENT_SUCCEEDED);
        batchClient.hincrby(currentDeploymentKeyLabelsHash, currentLabelActiveField, /* incrementBy */ 1);
        batchClient.hincrby(currentDeploymentKeyLabelsHash, currentLabelDeploymentSucceededField, /* incrementBy */ 1);

        if (previousDeploymentKey && previousLabel) {
          const previousDeploymentKeyLabelsHash: string = Utilities.getDeploymentKeyLabelsHash(previousDeploymentKey);
          const previousLabelActiveField: string = Utilities.getLabelActiveCountField(previousLabel);
          batchClient.hincrby(previousDeploymentKeyLabelsHash, previousLabelActiveField, /* incrementBy */ -1);
        }

        return this._safeCall<any[]>(this._metricsClient, this._promisifiedMetricsClient, "execBatch", batchClient);
      })
      .then(() => {})
      .catch(() => {});
  }

  public removeDeploymentKeyClientActiveLabel(deploymentKey: string, clientUniqueId: string): Promise<void> {
    return this.ensureMetricsSetup()
      .then(() => {
        const deploymentKeyClientsHash: string = Utilities.getDeploymentKeyClientsHash(deploymentKey);
        return this._safeCall<number>(
          this._metricsClient,
          this._promisifiedMetricsClient,
          "hdel",
          deploymentKeyClientsHash,
          clientUniqueId,
        );
      })
      .then(() => {})
      .catch(() => {});
  }

  public invalidateCache(expiryKey: string): Promise<void> {
    if (!this.isEnabled) return q(<void>null);

    return this._safeCall<void>(this._opsClient, this._promisifiedOpsClient, "del", expiryKey)
      .then(() => {})
      .catch(() => {});
  }

  // For unit tests only
  public close(): Promise<void> {
    const promiseChain: Promise<void> = q(<void>null);
    if (!this._opsClient && !this._metricsClient) return promiseChain;

    return promiseChain
      .then(() => {
        if (this._opsClient && this._opsClient.connected) {
          return this._promisifiedOpsClient.quit();
        }
      })
      .then(() => {
        if (this._metricsClient && this._metricsClient.connected) {
          return this._promisifiedMetricsClient.quit();
        }
      })
      .then(() => <void>null)
      .catch(() => {});
  }

  /* deprecated */
  public getCurrentActiveLabel(deploymentKey: string, clientUniqueId: string): Promise<string> {
    return this.ensureMetricsSetup()
      .then(() =>
        this._safeCall<string>(
          this._metricsClient,
          this._promisifiedMetricsClient,
          "hget",
          Utilities.getDeploymentKeyClientsHash(deploymentKey),
          clientUniqueId,
        ),
      )
      .catch(() => q<string>(null));
  }

  /* deprecated */
  public updateActiveAppForClient(deploymentKey: string, clientUniqueId: string, toLabel: string, fromLabel?: string): Promise<void> {
    return this.ensureMetricsSetup()
      .then(() => {
        const batchClient: any = (<any>this._metricsClient).batch();
        const deploymentKeyLabelsHash: string = Utilities.getDeploymentKeyLabelsHash(deploymentKey);
        const deploymentKeyClientsHash: string = Utilities.getDeploymentKeyClientsHash(deploymentKey);
        const toLabelActiveField: string = Utilities.getLabelActiveCountField(toLabel);

        batchClient.hset(deploymentKeyClientsHash, clientUniqueId, toLabel);
        batchClient.hincrby(deploymentKeyLabelsHash, toLabelActiveField, /* incrementBy */ 1);
        if (fromLabel) {
          const fromLabelActiveField: string = Utilities.getLabelActiveCountField(fromLabel);
          batchClient.hincrby(deploymentKeyLabelsHash, fromLabelActiveField, /* incrementBy */ -1);
        }

        return this._safeCall<any[]>(this._metricsClient, this._promisifiedMetricsClient, "execBatch", batchClient);
      })
      .then(() => {})
      .catch(() => {});
  }
}
