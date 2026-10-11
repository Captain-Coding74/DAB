Status: draft for review by a Thai data-protection lawyer — not legal advice. Reflects DAB v21.30 behaviour.

# Record of processing activities — DAB as processor (PDPA s.40)

Files uploaded to DAB often hold personal data about other people: a shop's customers, a company's staff, a school's students. For that data the user who uploads it, or the organisation they act for, is the controller. DAB processes it only to do what the user asks, so DAB is their processor. Section 40 then makes DAB directly responsible for following instructions, keeping the data secure, telling the controller about breaches, and keeping this record.

The processing agreement is section 6 of the Terms of Service ("Personal data in your files (processor terms)", `/terms#processor`). This record must match it.

## Processor and controllers

| | |
|---|---|
| Processor | The individual who runs DAB (`LEGAL_OPERATOR_NAME`); contact `LEGAL_CONTACT_EMAIL`, `LEGAL_POSTAL_ADDRESS` |
| Data protection officer | None appointed; see `dpo-assessment.md` |
| Controllers | Every account holder who uploads a file, or the organisation they act for (for School Edition files, normally the school). Each controller is identified by their account in `users`; the uploaded content is tied to it by `datasets.owner_id` and `analyses.user_id` |
| Agreement | Terms of Service section 6, accepted at sign-up (version, time and IP recorded) |
| Instructions | Using a DAB feature is the instruction (Terms section 6). DAB does not use the contents of uploads for purposes of its own |

Try mode (no account) is processing of the same kind for a visitor, but the file is parsed in memory and discarded, nothing from it is stored, and nothing goes to the AI.

## Data subjects and personal data

Whatever the controller's file is about. Typical cases:

- customers of a shop (names, phone numbers, addresses, LINE or other social-media IDs, purchases);
- staff (names, pay, departments);
- students, many of them minors under 20 (names, nicknames, birth dates, Thai citizen IDs, student IDs, scores) — School Edition;
- survey respondents (answers).

The Terms (section 5) ask users not to upload PDPA s.26 sensitive data without a lawful basis, and never to upload payment-card numbers. DAB cannot prevent it, so assume it may be present.

**Detection.** DAB looks for personal data in each upload: Thai citizen ID, phone, name, birth date and student ID; email, payment-card number, bank-account number, passport number, postal address, LINE or other social-media ID; and s.26 data recognised from the column header (health or medical, religion, ethnicity or race, disability, criminal record, sexual orientation, political opinion, trade-union membership, biometric). A detected column carries a `sensitive` marker with its kind. Detection can miss data, especially sensitive data under an unclear header.

## Processing operations

| # | Operation | What is processed | Kept? |
|---|---|---|---|
| P1 | Analyse a file | The file is parsed in memory into statistics, a quality score, findings, charts and, for class rosters, the class report | The file is discarded after the response |
| P2 | Keep the analysis in History | File name, the user's question, the AI report, column names, per-column statistics including the most frequent values (detected personal data masked), chart data, quality score. No IP address | Until deleted, at most 365 days |
| P3 | Save a dataset (opt-in) | The original file, exactly as uploaded, with its versions and column statistics. Saving is a separate "Save dataset" step with its own notice. A file that looks like a class roster can only be saved after the user confirms "I am authorised by my school to process these students' data"; the time of that confirmation is kept with the dataset | Until deleted; 365 days without activity; Trash 30 days |
| P4 | Work on a saved dataset | Previews, hypothesis tests, data fixes and AI Edit, which create new versions | As P3 |
| P5 | AI features (sub-processing by Anthropic) | See below | Not kept by DAB beyond P2 and chat |
| P6 | Chat and the deep-dive agent | The user's questions and the AI's answers, stored with the analysis | With the analysis |
| P7 | Share at the controller's instruction | Share link pages (AI text, column names, statistics and chart; no file name; no most-frequent values of personal-data columns; `noindex`); datasets shared with named users; workspaces | Share links expire after 1, 7, 30 or 90 days |
| P8 | Export | PDF and Excel files built on request and returned to the user; not stored | No |

### P5 — what goes to the AI

Only signed-in users trigger AI. The controller can switch it off per upload ("Statistics only — don't send to AI") and, as owner of a saved dataset, with the dataset's AI switch; AI features then refuse with `AI_DISABLED`.

Sent: the user's question; row and column counts; column names; summary statistics; the most frequent values of columns not detected as personal data; correlations and forecasts; insight sentences; chat history for chat.

Not sent: raw rows, by Analyze, Chat, the agent or fix suggestions. A detected personal-data column is left out of everything except its name and kind.

The one exception is AI Edit: after an explicit confirmation dialog it sends up to 300 rows of the columns not detected as personal data.

## Sub-processors

| Sub-processor | Role | Location | Terms |
|---|---|---|---|
| Anthropic PBC | AI features (Claude API) | USA | Commercial Terms and data-processing terms; details and open points in `vendors.md` |
| Hosting provider (`LEGAL_HOSTING_PROVIDER`) | Runs the server, database, file storage and logs | `LEGAL_HOSTING_REGION` | Host's terms and DPA — **to confirm** (`vendors.md`) |
| Database, cache or file-storage provider, if one is configured separately | Holds the database, cache or files | **to confirm** | **to confirm** |

The Terms promise to update the sub-processor list before adding another. Follow the change procedure in `vendors.md`.

## Transfers abroad and safeguards

| Destination | What | Basis — to confirm with counsel |
|---|---|---|
| Anthropic PBC, USA | The P5 payload | The Privacy Notice relies on the transfer being needed to perform the AI feature the user asks for, and on Anthropic's commercial and data-processing terms. The people in an uploaded file are not party to that contract, so the PDPA s.28 contract exception may not cover their data, and a s.29 safeguard (standard contractual clauses in Anthropic's data-processing terms) may be needed. Whether those clauses suit the PDPC, and whether they must be filed, is lawyer question 2 in `README.md` |
| Hosting region, if outside Thailand | Everything DAB stores | The host's DPA and its transfer clauses — **to confirm** |

Users can avoid the AI transfer completely by switching AI off.

## Retention and deletion

As `retention-schedule.md`. In short: an unsaved upload is not kept; analyses are deleted 365 days after creation; saved datasets when the user deletes them or after 365 days without activity; Trash after 30 days; everything an account owns when the account is deleted. Deleting a dataset deletes its analyses, chat, share links, comments and activity rows.

If DAB stops, or closes an account for any reason other than a breach of the Terms, a risk to DAB or other people, or a legal requirement, the Terms (section 11) promise an in-app announcement at least 30 days ahead so users can download their data, and deletion afterwards as the Privacy Notice describes.

## Security measures

As in `ropa-controller.md` ("Security measures"), plus, for upload content:

- personal-data detection, masking in the user's own view of identifiers such as citizen IDs and phone numbers, and the AI and share-page rules above;
- the original file is stored only when the user opts in;
- stored files encrypted at rest (AES-256-GCM) when `STORAGE_ENCRYPTION_KEY` is set; storage keys do not contain the file name;
- access to a stored dataset needs ownership or an explicit permission; workspace membership alone grants none.

## Duties to controllers

| Duty (Terms section 6) | How DAB meets it |
|---|---|
| Process only on instructions | Features act only when the user uses them. The one use of upload-derived data for DAB's own purpose is shape-only telemetry, which holds no names or values (controller record C7) |
| Confidentiality | The operator is the only person with access. Before anyone else gets access (a contractor, a helper), they sign a confidentiality undertaking, and this record is updated |
| Security | As above |
| Sub-processors | Only those listed; list updated before a change |
| Help with requests from people in the files | Refer the person to the controller and help the controller answer (`data-requests.md` section 6). The controller can export and delete the data themselves |
| Deletion | On the schedule, on the user's deletion, on account deletion |
| Breach notice | Tell the controller without undue delay. Internal target: within 48 hours of becoming aware that their data is affected, so they can meet their own 72-hour duty (`breach-response.md` step 6) |
