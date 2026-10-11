Status: draft for review by a Thai data-protection lawyer — not legal advice. Reflects DAB v21.30 behaviour.

# Does DAB need a data protection officer?

**Recommendation: no DPO is required at present, on the facts known today. Keep this assessment on file, name a privacy contact, and re-run it every six months or when a trigger below occurs.**

This is a cheap document to keep and an expensive one to lack: the first PDPA fine (August 2024, THB 7 million) included THB 1 million for failing to appoint a DPO when one was required.

## The test

PDPA s.41 requires a controller or processor to appoint a DPO when:

1. it is a public authority of a kind the PDPC prescribes; or
2. its **core activities** require **regular monitoring** of personal data or systems because it holds personal data in **large scale**; or
3. its core activity is collecting, using or disclosing **sensitive data under s.26**.

The PDPC Notification on DPO appointment (in force 13 December 2023) treats processing the personal data of **100,000 or more data subjects** as large scale, and lists other factors: the volume and kinds of data, how long and how permanently it is processed, the share of the possible population it covers, and its geographic reach. Only core activities count — those necessary and important to the main objectives of the business. The research found no exemption for small businesses from the DPO duty.

## Assessment

| Limb | DAB today | Conclusion | What is uncertain |
|---|---|---|---|
| 1. Public authority | Run by an individual | Does not apply | — |
| 2a. Large scale | Account holders: probably far below 100,000 (measure below). People inside uploaded files: not known — DAB does not link rows across uploads or build a picture of any person; unsaved uploads are discarded; saved datasets expire after 365 days without activity | Probably below the benchmark | How to count people inside users' files, and whether a processor counts them toward its own scale. Rows are not people: one person can appear in many files, and one file can describe thousands |
| 2b. Regular monitoring as a core activity | DAB analyses files when a user asks. It does not track the people in them over time. It does record its own users' activity: the traffic log (required by law), the audit log and telemetry linked to the user id | Probably not monitoring as a core activity | Whether the legally required traffic log, or telemetry linked to user ids, counts as "regular monitoring". The core activity is file analysis, not tracking users |
| 3. Sensitive data as a core activity | The Terms forbid uploading s.26 data without a lawful basis. DAB detects s.26 columns by header and keeps their values from the AI and from share pages. Some files will still contain it (a pharmacy's "patient" column, a school's disability notes) | Not a core activity | How much s.26 data actually arrives is unknown; telemetry tags such as "patient" give a rough signal |

**Minors.** School Edition invites teachers to upload records of students under 20. That is not s.26 data and not, by itself, a DPO trigger, but it raises the stakes of every other duty. It is the main reason to re-check this assessment early.

**ROPA consequence.** A DPO-required entity loses the small-business ROPA exemption; DAB keeps records of processing in any case (`ropa-controller.md`, `ropa-processor.md`), because it processes continuously and must keep computer traffic data.

## Recommendation

1. Do not appoint a DPO now. Record this assessment, its date and the numbers below.
2. Name the operator as the privacy contact. The legal pages already print `LEGAL_CONTACT_EMAIL` and `LEGAL_POSTAL_ADDRESS`; make sure both are set.
3. If you ever appoint a DPO voluntarily, the duties that come with the role apply. The Privacy Notice must then name the DPO and their contact, and the PDPC may need to be told (it publishes a form for this). Decide with counsel.
4. Re-run this assessment every six months, and at once when any trigger occurs.

## Triggers for an early review

- Account holders, or the rows of personal data in saved datasets, approach 100,000.
- DAB is offered to schools, hospitals or clinics as institutions (a school-wide plan, for example), or marketed for health data.
- A feature starts to follow individuals over time (alerts about a person, cross-file matching, profiles).
- Paid plans, a company structure, or staff with access to user data.
- A breach, or a PDPC inquiry.

## Measuring

Run on the production database (works on SQLite and Postgres) and record the results with the date:

```sql
SELECT COUNT(*) AS accounts FROM users;
SELECT COUNT(DISTINCT user_id) AS active_accounts_90_days FROM traffic_log WHERE user_id IS NOT NULL;
SELECT COUNT(*) AS saved_datasets, SUM(total_rows) AS rows_in_saved_datasets FROM datasets;
SELECT COUNT(*) AS analyses, SUM(total_rows) AS rows_analysed_last_365_days FROM analyses;
```

The row counts are an upper bound on people in stored files, not a head count.

| Date | Accounts | Active (90 days) | Saved datasets / rows | Analyses / rows | Reviewer | Outcome |
|---|---|---|---|---|---|---|
| | | | | | | |
