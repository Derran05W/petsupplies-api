# Pet Profiles (Phase 15)

## Overview

Authenticated customers can maintain **pet profiles** under **`/users/me/pets`**. Each row stores species, optional breed and birthday, optional weight (grams), dietary notes, and an optional **HTTPS photo URL** (no upload pipeline in this phase). The API is **CRUD + paginated list**, scoped **per JWT `sub`**, with a **soft cap of 50 pets per user** and **404-not-403** posture for missing or not-owned ids.

## Validation rules

| Surface | Rules |
| ------- | ----- |
| `POST` / `PATCH` body | `.strict()` (**unknown keys → 400**). See field table below. |
| `GET` query | `page`: positive integer (`coerce`; default **1**); `limit`: **1–100** integer (`coerce`; default **20**). |
| `:id` param | Prisma **cuid** shape (**25** chars, `c[a-z0-9]{24}`)—invalid **400** before service call. |

**Fields**

| Field | Rules |
| ----- | ----- |
| `name` | Required on create; **1–50** chars after trim. |
| `species` | `PetSpecies` enum: `DOG`, `CAT`, `FISH`, `BIRD`, `RABBIT`, `HAMSTER`, `GUINEA_PIG`, `REPTILE`, `OTHER`. |
| `breed` | Optional; when present, **1–100** chars after trim; use **`null` to clear**. Empty / whitespace-only strings are **invalid** (use `null`). |
| `birthDate` | Optional `Date`; normalized to **midnight UTC** on write. Allowed range: **`1900-01-01T00:00:00.000Z`** through **`now + 1 day`** (clock skew). Future dates beyond that window are rejected. |
| `weightGrams` | Optional integer **`1..1_000_000`**; **`null` clears**. |
| `dietaryNotes` | Optional **1–1000** chars after trim; **`null` clears**. No empty-string clears—use `null`. |
| `profilePhotoUrl` | Optional string, max **500** chars, must parse as a URL with **`https:`** scheme; **`null` clears**. Invalid URL or non-HTTPS → **400**. |

**Deferred (not in Phase 15)**

- **`GET /users/me/pets?species=`** filter—clients may filter locally (list is capped at **50** rows per user).

## Ownership semantics

- All endpoints require **`auth`**; **`userId`** is **`JWT sub`** only.
- Never accept **`userId`** in path, query, or body.
- **`GET /:id`** uses **`findFirst({ id, userId })`**.
- **`PATCH /:id`** / **`DELETE /:id`** use **`updateMany` / `deleteMany`** with **both** `id` and **`userId`**.

## Missing and not-owned pets

- **Missing** and **not-owned** ids are treated the same (**404 `PET_NOT_FOUND`**) so tenants cannot probe for other users’ pets (**404, never 403**).
- **`DELETE`** is **not** wishlist-idempotent: missing/not-owned returns **404 `PET_NOT_FOUND`** (not **204**).

## Capacity cap

- At most **50** pets per user (`count` before **`create`**).
- Over cap: **400 `PETS_LIMIT_REACHED`**.
- Soft guard: concurrent creates may briefly exceed by one; acceptable abuse-control tradeoff.

## API surface

| Method | Path | Auth | Success | Notes |
| ------ | ---- | ---- | ------- | ----- |
| `GET` | `/users/me/pets` | Yes | **200** | `{ data, page, limit, total, totalPages }`; sort **`createdAt` asc**. |
| `GET` | `/users/me/pets/:id` | Yes | **200** | **404 `PET_NOT_FOUND`** if missing/not-owned. |
| `POST` | `/users/me/pets` | Yes | **201** | **400 `PETS_LIMIT_REACHED`** at cap. |
| `PATCH` | `/users/me/pets/:id` | Yes | **200** | Partial update; **400 `EMPTY_PATCH`** if no fields; **404** if not found. |
| `DELETE` | `/users/me/pets/:id` | Yes | **204** | **404 `PET_NOT_FOUND`** if missing/not-owned. |

## Photo uploads

Phase **15** stores a **frontend-supplied HTTPS URL only** (length-bounded, scheme allowlisted). It does **not** upload, proxy, transform, or byte-validate images. A dedicated upload service is **deferred**.

## Safe logging policy

Structured **`console.info(JSON.stringify(...))`** lines include **`userId`**, **`petId`**, and **`op`** (`create` | `update` | `delete`) only. Never log **`name`**, **`breed`**, **`dietaryNotes`**, **`profilePhotoUrl`**, email, or raw bodies.

## Troubleshooting

| Symptom | Likelihood |
| ------- | ---------- |
| **400 `PETS_LIMIT_REACHED`** | User already has **50** pets; remove one or raise policy (not automatic). |
| **404 `PET_NOT_FOUND` on `GET`/`PATCH`/`DELETE`** | Wrong id, another user’s pet, or already deleted—indistinguishable by design. |
| **400 `EMPTY_PATCH` on `PATCH`** | Send at least one updatable field. |
| **400 on `profilePhotoUrl`** | Must be valid HTTPS URL within **500** chars; use **`null`** to clear. |
| **400 on `birthDate`** | Before **1900-01-01 UTC** or more than **~1 day** in the future. |

## Deferred

- **`GET` list `species` query filter** (defer; small per-user lists).
- **Photo upload / CDN integration** (URL storage only for now).
- **Pet-linked subscriptions** (**Phase 16** owns subscription contracts).
- **Recommendations / product affinity** (separate phases; **no** joins on `Pet` in Phase 15).
