# Cloudflare Durable Objects - Complete Feature Reference

Comprehensive documentation of all Cloudflare Durable Objects functionality and features, grounded with official Cloudflare documentation URLs.

Last updated: 2025-12-11

## Table of Contents
1. [Core Concepts](#core-concepts)
2. [WebSocket Support](#websocket-support)
3. [Storage APIs](#storage-apis)
4. [Lifecycle & Execution](#lifecycle--execution)
5. [Geographic Placement](#geographic-placement)
6. [Pricing Model](#pricing-model)
7. [Limits & Quotas](#limits--quotas)
8. [Best Practices & Patterns](#best-practices--patterns)
9. [Development & Testing](#development--testing)
10. [Observability](#observability)

---

## Core Concepts

| Feature | Description | Official Documentation URL |
|---------|-------------|---------------------------|
| **What are Durable Objects** | Special Workers that combine compute with storage, single-threaded, automatically provisioned geographically close to first request | [https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/) |
| **Single-threaded Model** | Each Durable Object instance is single-threaded and cooperatively multi-tasked, just like code in a web browser | [https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/) |
| **Global Uniqueness** | Each Durable Object has a globally-unique ID, allowing requests from anywhere in the world to the same object | [https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/) |
| **Durable Object Namespace** | Container for Durable Object instances, configured via bindings in wrangler.toml | [https://developers.cloudflare.com/durable-objects/api/namespace/](https://developers.cloudflare.com/durable-objects/api/namespace/) |
| **idFromName()** | Creates a unique DurableObjectId from a string name (most common method, deterministic) | [https://developers.cloudflare.com/durable-objects/api/namespace/](https://developers.cloudflare.com/durable-objects/api/namespace/) |
| **newUniqueId()** | Creates a randomly-generated unique DurableObjectId (best performance, requires storage) | [https://developers.cloudflare.com/durable-objects/api/namespace/](https://developers.cloudflare.com/durable-objects/api/namespace/) |
| **idFromString()** | Recreates DurableObjectId from a previously stringified ID (for retrieving stored IDs) | [https://developers.cloudflare.com/durable-objects/api/namespace/](https://developers.cloudflare.com/durable-objects/api/namespace/) |
| **get()** | Constructs a Durable Object stub (local client) to access remote Durable Object, creates if doesn't exist | [https://developers.cloudflare.com/durable-objects/api/namespace/](https://developers.cloudflare.com/durable-objects/api/namespace/) |
| **getByName()** | New simplified method to create stub directly from name without converting to ID first | [https://developers.cloudflare.com/changelog/2025-08-21-durable-objects-get-by-name/](https://developers.cloudflare.com/changelog/2025-08-21-durable-objects-get-by-name/) |
| **Durable Object Stub** | Local client that provides access to remote Durable Object, supports fetch() and RPC methods | [https://developers.cloudflare.com/durable-objects/api/stub/](https://developers.cloudflare.com/durable-objects/api/stub/) |
| **DurableObjectId** | Identifier object with toString() and equals() methods, optional name property | [https://developers.cloudflare.com/durable-objects/api/id/](https://developers.cloudflare.com/durable-objects/api/id/) |
| **DurableObjectState** | Context object passed to constructor containing storage, ID, and lifecycle methods | [https://developers.cloudflare.com/durable-objects/api/state/](https://developers.cloudflare.com/durable-objects/api/state/) |

---

## WebSocket Support

| Feature | Description | Official Documentation URL |
|---------|-------------|---------------------------|
| **WebSocket Hibernation API** | Extends Web Standard WebSocket API to reduce costs by hibernating DOs without disconnecting clients | [https://developers.cloudflare.com/durable-objects/best-practices/websockets/](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) |
| **acceptWebSocket()** | Accepts WebSocket connection on DurableObjectState, marks it as hibernatable to avoid pinning DO in memory | [https://developers.cloudflare.com/durable-objects/api/state/](https://developers.cloudflare.com/durable-objects/api/state/) |
| **webSocketMessage()** | Handler method called when WebSocket receives a message (not called for control frames) | [https://developers.cloudflare.com/durable-objects/api/base/](https://developers.cloudflare.com/durable-objects/api/base/) |
| **webSocketClose()** | Handler method called when WebSocket connection closes, receives code, reason, and wasClean parameters | [https://developers.cloudflare.com/durable-objects/api/base/](https://developers.cloudflare.com/durable-objects/api/base/) |
| **webSocketError()** | Handler method called for non-disconnection related WebSocket errors | [https://developers.cloudflare.com/durable-objects/api/base/](https://developers.cloudflare.com/durable-objects/api/base/) |
| **getWebSockets()** | Returns array of WebSockets attached to the Durable Object, optionally filtered by tag | [https://developers.cloudflare.com/durable-objects/api/state/](https://developers.cloudflare.com/durable-objects/api/state/) |
| **setWebSocketAutoResponse()** | Configures automatic ping/pong responses to keep WebSocket alive during hibernation | [https://developers.cloudflare.com/durable-objects/api/state/](https://developers.cloudflare.com/durable-objects/api/state/) |
| **getWebSocketAutoResponseTimestamp()** | Returns Date when WebSocket last sent auto-response, or null if never sent | [https://developers.cloudflare.com/durable-objects/api/state/](https://developers.cloudflare.com/durable-objects/api/state/) |
| **getTags()** | Returns tags associated with a WebSocket (from acceptWebSocket tags parameter) | [https://developers.cloudflare.com/durable-objects/api/state/](https://developers.cloudflare.com/durable-objects/api/state/) |
| **setHibernatableWebSocketEventTimeout()** | Sets timeout for hibernatable WebSocket events to control eviction timing | [https://developers.cloudflare.com/durable-objects/api/state/](https://developers.cloudflare.com/durable-objects/api/state/) |
| **serializeAttachment()** | Persists additional data with WebSocket to Durable Object storage for restoration after hibernation | [https://developers.cloudflare.com/durable-objects/best-practices/websockets/](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) |
| **deserializeAttachment()** | Retrieves data persisted with serializeAttachment after Durable Object restart | [https://developers.cloudflare.com/durable-objects/best-practices/websockets/](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) |
| **WebSocket Server Example** | Complete example showing standard WebSocket server implementation | [https://developers.cloudflare.com/durable-objects/examples/websocket-server/](https://developers.cloudflare.com/durable-objects/examples/websocket-server/) |
| **WebSocket Hibernation Example** | Complete example showing cost-optimized hibernation implementation | [https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/](https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/) |

---

## Storage APIs

| Feature | Description | Official Documentation URL |
|---------|-------------|---------------------------|
| **Storage API Overview** | Transactional and strongly consistent storage private to each Durable Object instance | [https://developers.cloudflare.com/durable-objects/api/storage-api/](https://developers.cloudflare.com/durable-objects/api/storage-api/) |
| **SQLite Storage Backend** | Recommended storage backend with SQL support, tables, and Point-in-Time Recovery (GA since 2025) | [https://developers.cloudflare.com/durable-objects/api/transactional-storage-api/](https://developers.cloudflare.com/durable-objects/api/transactional-storage-api/) |
| **KV Storage Backend (Legacy)** | Legacy key-value only storage backend (deprecated, use SQLite for new projects) | [https://developers.cloudflare.com/durable-objects/api/legacy-kv-storage-api/](https://developers.cloudflare.com/durable-objects/api/legacy-kv-storage-api/) |
| **sql.exec()** | Execute SQL queries against embedded SQLite database with bound parameters | [https://developers.cloudflare.com/durable-objects/api/transactional-storage-api/](https://developers.cloudflare.com/durable-objects/api/transactional-storage-api/) |
| **get()** | Retrieve one or multiple values from storage by key, with built-in in-memory cache | [https://developers.cloudflare.com/durable-objects/api/storage-api/](https://developers.cloudflare.com/durable-objects/api/storage-api/) |
| **put()** | Store one or multiple key-value pairs (stores in hidden SQLite table for SQLite backend) | [https://developers.cloudflare.com/durable-objects/api/storage-api/](https://developers.cloudflare.com/durable-objects/api/storage-api/) |
| **delete()** | Delete one or multiple keys from storage | [https://developers.cloudflare.com/durable-objects/api/storage-api/](https://developers.cloudflare.com/durable-objects/api/storage-api/) |
| **deleteAll()** | Delete all keys from storage | [https://developers.cloudflare.com/durable-objects/api/storage-api/](https://developers.cloudflare.com/durable-objects/api/storage-api/) |
| **list()** | Returns all keys and values in ascending order, supports prefix, start, end, limit for pagination | [https://developers.cloudflare.com/durable-objects/api/storage-api/](https://developers.cloudflare.com/durable-objects/api/storage-api/) |
| **transaction() / transactionSync()** | Execute multiple storage operations atomically in a transaction callback | [https://developers.cloudflare.com/durable-objects/api/transactional-storage-api/](https://developers.cloudflare.com/durable-objects/api/transactional-storage-api/) |
| **Point-in-Time Recovery (PITR)** | Restore SQLite database contents (SQL + KV data) to any point in past 30 days, enabled by default | [https://developers.cloudflare.com/durable-objects/api/storage-api/](https://developers.cloudflare.com/durable-objects/api/storage-api/) |
| **Bookmarks** | Alphanumeric strings representing points in time for PITR, lexically comparable | [https://developers.cloudflare.com/durable-objects/api/transactional-storage-api/](https://developers.cloudflare.com/durable-objects/api/transactional-storage-api/) |
| **SQLite Extensions** | Support for FTS5 (full-text search), JSON functions, and Math functions | [https://developers.cloudflare.com/durable-objects/api/transactional-storage-api/](https://developers.cloudflare.com/durable-objects/api/transactional-storage-api/) |
| **Built-in Caching** | Automatic in-memory cache for recently read/written values, instant retrieval | [https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/) |
| **Atomic Operations** | Each storage method implicitly wrapped in transaction for atomic and isolated results | [https://developers.cloudflare.com/durable-objects/api/transactional-storage-api/](https://developers.cloudflare.com/durable-objects/api/transactional-storage-api/) |
| **In-memory State** | Variables maintain state while DO in memory, survives between requests until eviction | [https://developers.cloudflare.com/durable-objects/reference/in-memory-state/](https://developers.cloudflare.com/durable-objects/reference/in-memory-state/) |
| **In-memory State Example** | Code example showing initialization pattern with in-memory caching | [https://developers.cloudflare.com/durable-objects/examples/durable-object-in-memory-state/](https://developers.cloudflare.com/durable-objects/examples/durable-object-in-memory-state/) |

---

## Lifecycle & Execution

| Feature | Description | Official Documentation URL |
|---------|-------------|---------------------------|
| **Lifecycle Overview** | Complete lifecycle from creation through active, idle, hibernation, and eviction states | [https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/) |
| **Constructor** | Called when DO wakes up, receives DurableObjectState and env parameters, runs before first request | [https://developers.cloudflare.com/durable-objects/api/base/](https://developers.cloudflare.com/durable-objects/api/base/) |
| **fetch() Handler** | HTTP request handler method, receives Request returns Response (legacy, prefer RPC) | [https://developers.cloudflare.com/durable-objects/best-practices/create-durable-object-stubs-and-send-requests/](https://developers.cloudflare.com/durable-objects/best-practices/create-durable-object-stubs-and-send-requests/) |
| **RPC Methods** | Modern approach to invoke custom methods on DO class (compatibility date >= 2024-04-03) | [https://developers.cloudflare.com/durable-objects/best-practices/create-durable-object-stubs-and-send-requests/](https://developers.cloudflare.com/durable-objects/best-practices/create-durable-object-stubs-and-send-requests/) |
| **RPC Compatibility** | Requires compatibility date 2024-04-03 or higher, or 'rpc' in compatibility flags | [https://developers.cloudflare.com/workers/runtime-apis/rpc/](https://developers.cloudflare.com/workers/runtime-apis/rpc/) |
| **Alarms** | Schedule single alarm per DO that fires at specified time with guaranteed at-least-once execution | [https://developers.cloudflare.com/durable-objects/api/alarms/](https://developers.cloudflare.com/durable-objects/api/alarms/) |
| **alarm() Handler** | Called when scheduled alarm fires, receives retryCount and isRetry info, auto-retries on failure | [https://developers.cloudflare.com/durable-objects/api/alarms/](https://developers.cloudflare.com/durable-objects/api/alarms/) |
| **getAlarm()** | Returns scheduled alarm time in milliseconds since epoch, or null if no alarm set | [https://developers.cloudflare.com/durable-objects/api/alarms/](https://developers.cloudflare.com/durable-objects/api/alarms/) |
| **setAlarm()** | Set alarm time in milliseconds since epoch, overrides existing alarm if present | [https://developers.cloudflare.com/durable-objects/api/alarms/](https://developers.cloudflare.com/durable-objects/api/alarms/) |
| **deleteAlarm()** | Remove scheduled alarm, may prevent retries on best-effort basis if called in alarm() | [https://developers.cloudflare.com/durable-objects/api/alarms/](https://developers.cloudflare.com/durable-objects/api/alarms/) |
| **Alarms Example** | Complete code example showing alarm API usage and patterns | [https://developers.cloudflare.com/durable-objects/examples/alarms-api/](https://developers.cloudflare.com/durable-objects/examples/alarms-api/) |
| **blockConcurrencyWhile()** | Blocks other events until async callback completes, commonly used in constructor for initialization | [https://developers.cloudflare.com/durable-objects/api/state/](https://developers.cloudflare.com/durable-objects/api/state/) |
| **waitUntil()** | Available but has no effect in Durable Objects (Workers-only API retained for compatibility) | [https://developers.cloudflare.com/durable-objects/api/state/](https://developers.cloudflare.com/durable-objects/api/state/) |
| **CPU Time Limit** | 30 seconds per incoming request/WebSocket message, resets with each new network request | [https://developers.cloudflare.com/durable-objects/platform/limits/](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| **Eviction (70-140s)** | Inactive non-hibernatable DOs evicted from memory after 70-140 seconds of inactivity | [https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/) |
| **Hibernation** | WebSocket-connected DOs can hibernate during inactivity to avoid duration charges | [https://developers.cloudflare.com/durable-objects/best-practices/websockets/](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) |
| **Bindings Configuration** | Configure DO bindings in wrangler.toml with name and class_name, optional script_name | [https://developers.cloudflare.com/workers/wrangler/configuration/](https://developers.cloudflare.com/workers/wrangler/configuration/) |

---

## Geographic Placement

| Feature | Description | Official Documentation URL |
|---------|-------------|---------------------------|
| **Default Placement** | DO instantiated in data center close to initial get() request, doesn't change after creation | [https://developers.cloudflare.com/durable-objects/reference/data-location/](https://developers.cloudflare.com/durable-objects/reference/data-location/) |
| **Location Hints** | Optional locationHint parameter to get() suggests geographic location, best-effort not guaranteed | [https://developers.cloudflare.com/durable-objects/reference/data-location/](https://developers.cloudflare.com/durable-objects/reference/data-location/) |
| **Location Hint Limitations** | Hints minimize latency from hinted location, may spawn in nearby location if hinted location lacks DO support | [https://developers.cloudflare.com/durable-objects/reference/data-location/](https://developers.cloudflare.com/durable-objects/reference/data-location/) |
| **Jurisdictions** | Strict geographic constraint that forces DO to run and store data only within specified region | [https://developers.cloudflare.com/durable-objects/reference/data-location/](https://developers.cloudflare.com/durable-objects/reference/data-location/) |
| **Jurisdiction Subnamespaces** | Call namespace.jurisdiction('eu' or 'fedramp') to create subnamespace with geographic constraints | [https://developers.cloudflare.com/data-localization/how-to/durable-objects/](https://developers.cloudflare.com/data-localization/how-to/durable-objects/) |
| **Data Localization Suite** | Integration with Cloudflare's Data Localization Suite for compliance (GDPR, FedRAMP) | [https://developers.cloudflare.com/data-localization/how-to/durable-objects/](https://developers.cloudflare.com/data-localization/how-to/durable-objects/) |
| **Regional Coverage Gaps** | No DO support in Africa or South America (route to nearby regions), limited Asia-Pacific coverage | [https://developers.cloudflare.com/durable-objects/reference/data-location/](https://developers.cloudflare.com/durable-objects/reference/data-location/) |

---

## Pricing Model

| Feature | Description | Official Documentation URL |
|---------|-------------|---------------------------|
| **Pricing Overview** | Billed for compute (requests + duration) and storage, available on Free and Paid plans | [https://developers.cloudflare.com/durable-objects/platform/pricing/](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| **Workers Free Plan** | Only SQLite-backed DOs, 100k requests/day, 13k GB-s/day, 5GB storage limit | [https://developers.cloudflare.com/durable-objects/platform/pricing/](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| **Workers Paid Plan** | $5/month minimum, both SQLite and KV-backed DOs, no account storage limit, 10GB per DO | [https://developers.cloudflare.com/durable-objects/platform/pricing/](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| **Free Tier (Paid Plan)** | 1M requests/month free, then $0.15 per million requests | [https://developers.cloudflare.com/durable-objects/platform/pricing/](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| **Duration Billing** | Charges for 128MB memory allocation while DO active, shared memory still billed per-instance | [https://developers.cloudflare.com/durable-objects/platform/pricing/](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| **SQLite Storage Billing** | Effective 2026-01-07 (no earlier), matches D1 pricing for rows read/written | [https://developers.cloudflare.com/durable-objects/platform/pricing/](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| **Storage Measurement** | Measured in gigabytes (1GB = 1,000,000,000 bytes), not gibibytes | [https://developers.cloudflare.com/durable-objects/platform/limits/](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| **Hibernation Cost Savings** | No duration charges during hibernation, WebSocket stays connected, dramatically reduces costs | [https://developers.cloudflare.com/durable-objects/best-practices/websockets/](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) |
| **setAlarm() Billing** | Each setAlarm() call billed as single row written | [https://developers.cloudflare.com/durable-objects/platform/pricing/](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| **Free Tier Limits** | Exceeding daily limits causes operations to fail with error until 00:00 UTC reset | [https://developers.cloudflare.com/durable-objects/platform/pricing/](https://developers.cloudflare.com/durable-objects/platform/pricing/) |

---

## Limits & Quotas

| Feature | Description | Official Documentation URL |
|---------|-------------|---------------------------|
| **Limits Overview** | Comprehensive limits documentation covering requests, CPU, storage, and more | [https://developers.cloudflare.com/durable-objects/platform/limits/](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| **Request Throughput** | 1,000 requests/second soft limit per individual DO instance (unlimited instances per namespace) | [https://developers.cloudflare.com/durable-objects/platform/limits/](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| **CPU Time** | 30 seconds per request/WebSocket message, resets with each network request, active processing only | [https://developers.cloudflare.com/durable-objects/platform/limits/](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| **Storage per DO (Free)** | 5GB total across all DOs in account (SQLite only) | [https://developers.cloudflare.com/durable-objects/platform/limits/](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| **Storage per DO (Paid)** | 10GB per individual SQLite-backed DO, no account-level limit | [https://developers.cloudflare.com/durable-objects/platform/limits/](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| **Memory Allocation** | 128MB allocated per DO (may share if same class on same machine, still billed separately) | [https://developers.cloudflare.com/durable-objects/platform/limits/](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| **Unlimited Instances** | No limit on number of individual DO instances per namespace, horizontal scaling supported | [https://developers.cloudflare.com/durable-objects/platform/limits/](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| **Overload Behavior** | DO receiving too many requests will queue then return overloaded error to caller | [https://developers.cloudflare.com/durable-objects/platform/limits/](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| **Empty SQLite Size** | Empty SQLite database consumes approximately 12KB of storage | [https://developers.cloudflare.com/durable-objects/platform/limits/](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| **Limit Increase Requests** | Can request adjustments via Limit Increase Request Form for eligible limits | [https://developers.cloudflare.com/durable-objects/platform/limits/](https://developers.cloudflare.com/durable-objects/platform/limits/) |

---

## Best Practices & Patterns

| Feature | Description | Official Documentation URL |
|---------|-------------|---------------------------|
| **Best Practices Overview** | Collection of recommended patterns and practices for Durable Objects | [https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/) |
| **Control/Data Plane Pattern** | Separate control plane (admin APIs) from data plane (resource operations) for better performance | [https://developers.cloudflare.com/reference-architecture/diagrams/storage/durable-object-control-data-plane-pattern/](https://developers.cloudflare.com/reference-architecture/diagrams/storage/durable-object-control-data-plane-pattern/) |
| **Horizontal Sharding** | Shard application data across many DOs to avoid single-instance limits and scale globally | [https://developers.cloudflare.com/reference-architecture/diagrams/storage/durable-object-control-data-plane-pattern/](https://developers.cloudflare.com/reference-architecture/diagrams/storage/durable-object-control-data-plane-pattern/) |
| **One Database Per User** | Pattern using idFromName(userId) for consistent user-to-DO mapping, each user gets own database | [https://developers.cloudflare.com/reference-architecture/diagrams/storage/durable-object-control-data-plane-pattern/](https://developers.cloudflare.com/reference-architecture/diagrams/storage/durable-object-control-data-plane-pattern/) |
| **Storage Persistence** | Always use Storage API for state that must survive eviction, don't rely solely on in-memory state | [https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/) |
| **Prefer SQLite Backend** | Cloudflare recommends all new namespaces use SQLite storage for richer features | [https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/) |
| **Avoid Pre-creation** | Don't pre-create DOs, let them create on first actual production request for optimal latency | [https://developers.cloudflare.com/durable-objects/reference/data-location/](https://developers.cloudflare.com/durable-objects/reference/data-location/) |
| **Use RPC for New Projects** | Prefer RPC methods over fetch() for cleaner API and better type safety (2024-04-03+) | [https://developers.cloudflare.com/durable-objects/best-practices/create-durable-object-stubs-and-send-requests/](https://developers.cloudflare.com/durable-objects/best-practices/create-durable-object-stubs-and-send-requests/) |
| **WebSocket Hibernation** | Use hibernation API to dramatically reduce costs for sparse message patterns | [https://developers.cloudflare.com/durable-objects/best-practices/websockets/](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) |
| **Coordination Use Cases** | Ideal for collaborative editing, chat, multiplayer games, notifications, distributed systems | [https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/) |
| **Demo Applications** | Workers Chat Demo (real-time chat), Wildebeest (ActivityPub/Mastodon server) | [https://developers.cloudflare.com/durable-objects/demos/](https://developers.cloudflare.com/durable-objects/demos/) |

---

## Development & Testing

| Feature | Description | Official Documentation URL |
|---------|-------------|---------------------------|
| **Getting Started Guide** | Step-by-step tutorial for creating first Durable Object | [https://developers.cloudflare.com/durable-objects/get-started/](https://developers.cloudflare.com/durable-objects/get-started/) |
| **Local Development** | Develop and test DOs locally using Miniflare and workerd runtime (same as production) | [https://developers.cloudflare.com/workers/development-testing/](https://developers.cloudflare.com/workers/development-testing/) |
| **wrangler dev** | Local development server with live reload, runs DOs using workerd runtime | [https://developers.cloudflare.com/workers/development-testing/](https://developers.cloudflare.com/workers/development-testing/) |
| **wrangler dev --remote** | Tunnel from local environment to Cloudflare network for testing in production-like environment | [https://developers.cloudflare.com/workers/development-testing/](https://developers.cloudflare.com/workers/development-testing/) |
| **wrangler tail** | Live feed of console and exception logs for deployed Workers and Durable Objects | [https://developers.cloudflare.com/workers/observability/logs/real-time-logs/](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/) |
| **Miniflare** | Fully-local DO simulator using workerd, eliminates behavior mismatches with production | [https://developers.cloudflare.com/workers/testing/miniflare/](https://developers.cloudflare.com/workers/testing/miniflare/) |
| **Miniflare v3** | Current version built on workerd runtime (v2 deprecated, uses Node.js) | [https://developers.cloudflare.com/workers/testing/miniflare/](https://developers.cloudflare.com/workers/testing/miniflare/) |
| **Vitest Integration** | Test DOs with vitest-pool-workers running tests in actual Workers runtime offline | [https://developers.cloudflare.com/workers/development-testing/](https://developers.cloudflare.com/workers/development-testing/) |
| **Local Persistence** | Enable file system persistence for local DO storage during development | [https://developers.cloudflare.com/workers/testing/miniflare/storage/durable-objects/](https://developers.cloudflare.com/workers/testing/miniflare/storage/durable-objects/) |
| **Remote Bindings** | Configure local dev to interact with production resources instead of local simulations | [https://developers.cloudflare.com/workers/development-testing/](https://developers.cloudflare.com/workers/development-testing/) |
| **Migrations** | Required for creating, renaming, deleting, or transferring DO classes via wrangler.toml | [https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/) |
| **New Class Migration** | Most common migration, informs runtime that new DO class is being uploaded | [https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/) |
| **Rename Migration** | Transfer stored DOs between two classes in same Worker, preserves data | [https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/) |
| **Transfer Migration** | Move DO class from one Worker script to another, creates destination class automatically | [https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/) |
| **Delete Migration** | Permanently deletes all DOs and data for a class, requires binding removal first | [https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/) |
| **PITR Not in Local** | Point-in-time recovery not supported in local development (no durable log stored locally) | [https://developers.cloudflare.com/durable-objects/api/transactional-storage-api/](https://developers.cloudflare.com/durable-objects/api/transactional-storage-api/) |

---

## Observability

| Feature | Description | Official Documentation URL |
|---------|-------------|---------------------------|
| **Workers Observability** | Dashboard section for querying log events, metrics, and analytics across all Workers/DOs | [https://developers.cloudflare.com/workers/observability/](https://developers.cloudflare.com/workers/observability/) |
| **Metrics and Analytics** | Namespace-level and request-level metrics accessible via dashboard and GraphQL API | [https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/](https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/) |
| **Workers Logs** | Automatically collect, store, filter, and analyze logging data from Workers and DOs | [https://developers.cloudflare.com/workers/observability/logs/workers-logs/](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) |
| **Logs Daily Limit** | 5 billion logs per account per day, 1% head sample applied after limit | [https://developers.cloudflare.com/workers/observability/logs/workers-logs/](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) |
| **$workers.durableObjectId** | Log field to identify specific DO instance that generated log entry | [https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/](https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/) |
| **Query Builder** | Construct structured queries, explore logs, extract metrics, create visualizations | [https://developers.cloudflare.com/workers/observability/](https://developers.cloudflare.com/workers/observability/) |
| **Real-time Logs** | Live log streaming for debugging and monitoring with wrangler tail command | [https://developers.cloudflare.com/workers/observability/logs/real-time-logs/](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/) |
| **Tail Workers** | Custom Workers that receive and process logs from producer Workers/DOs for alerts/analytics | [https://developers.cloudflare.com/workers/observability/logs/tail-workers/](https://developers.cloudflare.com/workers/observability/logs/tail-workers/) |
| **Tail Workers Billing** | Billed by CPU time not requests, available on Workers Paid and Enterprise tiers | [https://developers.cloudflare.com/workers/observability/logs/tail-workers/](https://developers.cloudflare.com/workers/observability/logs/tail-workers/) |
| **OpenTelemetry Export** | Alternative to Tail Workers, batch export logs/traces to observability tools (Sentry, Grafana, etc) | [https://developers.cloudflare.com/workers/observability/](https://developers.cloudflare.com/workers/observability/) |
| **GraphQL Analytics API** | Programmatic access to metrics via GraphQL or HTTP client | [https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/](https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/) |
| **Data Studio** | Built-in SQL browser in dashboard to view/write data in SQLite-backed DOs (Workers Platform Admin role required) | [https://developers.cloudflare.com/durable-objects/observability/data-studio/](https://developers.cloudflare.com/durable-objects/observability/data-studio/) |
| **Troubleshooting Guide** | Common issues and solutions for Durable Objects development | [https://developers.cloudflare.com/durable-objects/observability/troubleshooting/](https://developers.cloudflare.com/durable-objects/observability/troubleshooting/) |
| **Invocations** | Mechanisms to trigger DO execution (alarms, cron jobs, fetch), emit log events | [https://developers.cloudflare.com/workers/observability/](https://developers.cloudflare.com/workers/observability/) |
| **FAQ** | Frequently asked questions covering common DO scenarios and issues | [https://developers.cloudflare.com/durable-objects/reference/faq/](https://developers.cloudflare.com/durable-objects/reference/faq/) |

---

## Additional Resources

| Resource | Description | URL |
|----------|-------------|-----|
| **Main Documentation** | Complete Cloudflare Durable Objects documentation | [https://developers.cloudflare.com/durable-objects/](https://developers.cloudflare.com/durable-objects/) |
| **Release Notes** | Latest updates and changes to Durable Objects | [https://developers.cloudflare.com/durable-objects/release-notes/](https://developers.cloudflare.com/durable-objects/release-notes/) |
| **Examples** | Collection of code examples and sample applications | [https://developers.cloudflare.com/durable-objects/examples/](https://developers.cloudflare.com/durable-objects/examples/) |
| **Product Page** | Marketing overview of Durable Objects | [https://www.cloudflare.com/developer-platform/products/durable-objects/](https://www.cloudflare.com/developer-platform/products/durable-objects/) |
| **Blog: SQLite in DOs** | Announcement of zero-latency SQLite storage | [https://blog.cloudflare.com/sqlite-in-durable-objects/](https://blog.cloudflare.com/sqlite-in-durable-objects/) |
| **Blog: DO Alarms** | Introduction to Alarms feature | [https://blog.cloudflare.com/durable-objects-alarms/](https://blog.cloudflare.com/durable-objects/alarms/) |
| **Blog: Workers Observability** | Announcement of unified observability platform | [https://blog.cloudflare.com/introducing-workers-observability-logs-metrics-and-queries-all-in-one-place/](https://blog.cloudflare.com/introducing-workers-observability-logs-metrics-and-queries-all-in-one-place/) |
| **Blog: Wrangler 3** | Improved local development with workerd | [https://blog.cloudflare.com/wrangler3/](https://blog.cloudflare.com/wrangler3/) |
| **Environments** | Guide to using multiple environments with Durable Objects | [https://developers.cloudflare.com/durable-objects/reference/environments/](https://developers.cloudflare.com/durable-objects/reference/environments/) |

---

## Key Takeaways

### When to Use Durable Objects
- **Coordination**: Multiple clients need to work together (chat, collaboration, multiplayer games)
- **Real-time**: WebSocket connections requiring state synchronization
- **Consistency**: Strong consistency guarantees needed (transactions, sequential operations)
- **Stateful compute**: Need to combine computation with persistent storage
- **Global uniqueness**: Single source of truth for specific resource/entity

### Storage Backend Choice
- **SQLite (Recommended)**: Use for new projects, supports SQL queries, tables, PITR, 10GB limit
- **KV (Legacy)**: Only use for existing projects on compatibility dates < 2024-04-03

### Communication Patterns
- **RPC (Modern)**: Type-safe method calls, recommended for compatibility date >= 2024-04-03
- **fetch() (Legacy)**: HTTP request/response pattern, use when RPC not available or HTTP semantics required

### Cost Optimization
- Use WebSocket Hibernation API to eliminate duration charges during idle periods
- Shard data across multiple DOs rather than overloading single instance
- Let DOs create on-demand rather than pre-creating
- Use alarms for background tasks instead of polling

### Architecture Best Practices
- Separate control plane (admin) from data plane (operations)
- Shard horizontally across many DO instances
- Store critical state in Storage API, not just in-memory
- Use idFromName() for deterministic routing (e.g., per-user DOs)
- Use newUniqueId() for best performance when you have storage for the ID

---

*This reference was compiled from official Cloudflare documentation as of December 2025.*
