# Security Specification — Run Coach

## 1. Data Invariants
1. A user profile `/users/{userId}` can only be read, created, or updated by the authenticated, email-verified user whose `request.auth.uid == userId` and `data.userId == request.auth.uid`.
2. A running goal `/users/{userId}/goals/{goalId}` cannot exist without a verified parent `/users/{userId}` document owned by `request.auth.uid`.
3. Once a running goal reaches terminal state `status == 'archived'`, no further client updates are permitted.
4. A training activity `/users/{userId}/activities/{activityId}` cannot exist without a verified parent `/users/{userId}` document owned by `request.auth.uid`, and `trainingLoad`, `durationMinutes`, and `rpe` must stay within valid physiological bounds.
5. A daily check-in `/users/{userId}/checkins/{checkinId}` cannot exceed 60 minutes (`availableMinutes <= 60`) when `environment` is `'indoor_treadmill'` or `'indoor_core'`. Once `completed == true`, the prescribed plan fields are locked.
6. Coach follow-up messages `/users/{userId}/checkins/{checkinId}/messages/{messageId}` require the parent check-in document to exist and belong to `request.auth.uid`, and messages are append-only (`update` forbidden).
7. Physio consults `/users/{userId}/physioConsults/{consultId}` require a verified parent `/users/{userId}` document and are append-only (`update` forbidden).
8. User access & subscription records `/userAccess/{accessId}` can only be created, listed, or deleted by the verified Super User (`request.auth.token.email_verified == true && request.auth.token.email == 'brokelman@gmail.com'`). A regular verified user may only `get` their own access document (`resource == null || resource.data.email == request.auth.token.email`) and may only `update` `['lastLoginAt', 'displayName', 'updatedAt']` on their own existing record without altering `role`, `accessStatus`, `hasPaidSubscription`, `trialStartDate`, `trialEndsAt`, or `paidUntil`.
9. Unverified email tokens (`email_verified != true`), arbitrary shadow fields, oversized strings, and non-matching document IDs are unconditionally denied.

## 2. The "Dirty Dozen" Adversarial Payloads (Expected: PERMISSION_DENIED)
1. **Unauthenticated read**: `GET /users/uid_123` with `auth == null` -> `PERMISSION_DENIED`.
2. **Cross-user profile read**: `GET /users/uid_other` authenticated as `uid_123` -> `PERMISSION_DENIED`.
3. **Unverified email write**: `CREATE /users/uid_123` with `auth.token.email_verified == false` -> `PERMISSION_DENIED`.
4. **Identity spoofing on goal create**: `CREATE /users/uid_123/goals/g1` with `userId: "uid_other"` -> `PERMISSION_DENIED`.
5. **Shadow field injection on profile**: `CREATE /users/uid_123` with extra field `isAdmin: true` -> `PERMISSION_DENIED`.
6. **ID poisoning**: `CREATE /users/uid_123/goals/invalid$id!` -> `PERMISSION_DENIED`.
7. **Timestamp spoofing**: `CREATE /users/uid_123/activities/a1` with client-supplied `createdAt` not equal to `request.time` -> `PERMISSION_DENIED`.
8. **Immutable field tampering**: `UPDATE /users/uid_123/goals/g1` changing `createdAt` or `userId` -> `PERMISSION_DENIED`.
9. **Terminal state bypass**: `UPDATE /users/uid_123/goals/g1` where existing `status == 'archived'` -> `PERMISSION_DENIED`.
10. **Indoor 60-min invariant breach**: `CREATE /users/uid_123/checkins/2026-11-13` with `environment: "indoor_treadmill"` and `availableMinutes: 90` -> `PERMISSION_DENIED`.
11. **Non-admin user access escalation**: `CREATE /userAccess/attacker_at_test_dot_com` or `UPDATE /userAccess/member_at_test_dot_com` changing `hasPaidSubscription: true` by a non-superadmin user -> `PERMISSION_DENIED`.
12. **Cross-user access record read/list**: `LIST /userAccess` or `GET /userAccess/other_at_test_dot_com` authenticated as a non-superadmin user -> `PERMISSION_DENIED`.
