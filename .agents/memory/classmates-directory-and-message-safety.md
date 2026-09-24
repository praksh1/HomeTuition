# Classmates can find each other without exposing moderation

Owner request, 24 September 2026: students should see other participants and be able to message privately. The public classroom directory is connected student display names and user ids only; it includes the viewer and excludes the teacher. The teacher-only floor rows, request times, microphone/camera grants, email and phone must never be included. Keep this explicit allow-list separate from moderation views and test both.

Opening a classmate composes privately inside a modal; it must not navigate away from or unmount the live call. Replies/history remain in Messages. This is not a second in-class chat or a complete inline DM thread.

Private messages and reactions independently check suspended accounts, bilateral blocking, and (for two students) shared valid session enrollment. Refunded enrollment and cancelled classes do not qualify; test admission follows the existing server gate. Blocking is durable, belongs to its creator and prevents new messages/reactions in both directions. Old private history remains accessible to its two participants for evidence. Send, react and block serialize on the same database pair lock; never trust a client button as authorization.

Safety & help in the conversation can block/unblock or start an inappropriate-behavior support report naming the other user's id. This does not automatically attach a private transcript, ban someone or expose their contact information. Any future age/guardian/consent policies need separate product review before public launch.
