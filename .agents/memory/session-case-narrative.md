# One session, one readable operator case narrative

Owner decision, 5 September 2026: every refund investigation tied to a class must show a concise,
human-readable account for that unique session ID, followed by the underlying chronological trail.
An operator should not have to translate `session.created` or infer the story from unrelated rows.

The summary must be generated from stored evidence at read time, not saved as prose and not written
by a language model. Every sentence must remain traceable to a row. Missing instrumentation is
shown as **not available**, never converted into “never happened” or a fabricated zero.

The first slice uses existing records: class creation and current listing, schedule changes,
bookings and payment-reference state, persistent class-thread messages, class start/end, socket
attendance, reconnect gaps, accepted whiteboard-change counts and in-class chat counts. It lives in
`api-server/src/lib/sessionCaseNarrative.ts` and is returned on the operator ticket detail route.

Still unavailable until deliberately instrumented: camera/microphone/reaction/hand-raise/screen-
share history; message read receipts; first whiteboard stroke, clear operations and per-tool use;
coarse connection-quality buckets; independent payment-provider reconciliation; independent media-
provider presence. The operator screen says each of these plainly.

This narrative is evidence for a person. It never approves or denies a refund.
