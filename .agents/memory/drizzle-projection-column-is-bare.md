# A column reference in a Drizzle select projection is *not* qualified

`sql` templates behave differently depending on where they sit.

In a **where clause**, `${table.column}` renders qualified:

```sql
where ("recurring_days"."recurring_id" = $1 and "recurring_days"."status" = $2)
```

In a **select projection**, the same interpolation renders **bare**:

```sql
select "id", "scheduled_for", ( select ... where m.makeup_for_id = "id" ... )
```

That bare `"id"` is the trap. Inside a subquery that reads from the same table, it binds to the
**subquery's** row, not the outer one — so a correlated subquery silently becomes
`m.makeup_for_id = m.id` and matches nothing.

**Nothing errors.** The query runs and returns plausible rows with the wrong answer. Here it
made every make-up class disappear: a teacher who had put every missed class right was still
shown five black marks, and would have been suspended for them. The identical subquery in
`abusesIn` was correct only because it happened to sit in a where clause.

**Write the outer column out in full inside a projection subquery** — `recurring_days.id`, as
literal text, never interpolated. And when a subquery reads from the table it is correlating
against, alias the inner one (`recurring_days m`) so the two are impossible to confuse by eye.

Found by printing `query.toSQL()`. When a query returns the wrong answer and the same SQL works
by hand in psql, print the generated SQL before suspecting anything else.
