# Every place a file lands needs its own answer to "who may open it?"

`GET /storage/file` (artifacts/api-server/src/routes/storage.ts) does not have a general rule.
It refuses by default and then asks a series of specific questions:

- the person who uploaded it (read out of the key itself — `ownerOf`)
- a support agent
- the reporter of the dispute the file is attached to
- the people a homework belongs to (`lib/homeworkAccess.ts`)
- the two people in the conversation a message was sent in (`lib/messageAccess.ts`)

That list is the whole rule. **Adding a fourth or fifth place that stores a file key does not
extend it** — the new feature is simply refused until somebody writes its check.

## Why this keeps catching people

The sender is always the uploader, so **the person who builds the feature can always open the
file**. Attaching a photo to a message looked completely finished from the sending side while
every recipient got a 403. Nothing in the sending flow, the database, or the thread response
was wrong; the bubble appeared with the file on it and the file would not open.

It found its way into a test only because the check signs in as the *recipient*. A suite that
uploads, attaches and reads back as one person proves nothing about this.

## What to do

When a new feature stores an object key, write a `mayOpenXFile(key, userId)` beside the tables
it is about and add one line to the route — the same shape as `homeworkAccess.ts` and
`messageAccess.ts`. Then test it as somebody who did not upload the file.

Related: `.agents/memory/schema-change-deploy-window.md` for why the tables holding these keys
are new tables rather than columns.
