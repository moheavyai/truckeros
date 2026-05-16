# State Data Entry Template

**Purpose:**  
Use this template when adding a new state to the `state_permit_rules` table. It helps maintain consistency, accuracy, and completeness.

---

## Required Fields

| Field                              | Format / Example          | Notes |
|------------------------------------|---------------------------|-------|
| `state_code`                       | 2-letter uppercase (e.g. `CA`) | Must match USPS abbreviation |
| `state_name`                       | Full name (e.g. `California`) | Official state name |
| `legal_width_ft`                   | Number (e.g. `8.5`)       | Legal limit without permit |
| `legal_height_ft`                  | Number (e.g. `13.5`)      | Legal limit without permit |
| `legal_length_ft`                  | Number (e.g. `53`)        | Legal limit without permit |
| `legal_weight_lbs`                 | Number (e.g. `80000`)     | Legal gross weight without permit |
| `permit_threshold_width_ft`        | Number or NULL            | Use same as legal if no buffer |
| `permit_threshold_height_ft`       | Number or NULL            | Use same as legal if no buffer |
| `permit_threshold_length_ft`       | Number or NULL            | Use same as legal if no buffer |
| `permit_threshold_weight_lbs`      | Number or NULL            | Use same as legal if no buffer |
| `source`                           | Text (e.g. "California DOT 2025") | Where the data came from |
| `last_updated`                     | Timestamp                 | Use `NOW()` when adding/updating |

---

## Recommended Fields (Strongly Suggested)

| Field                              | Format / Example                  | Notes |
|------------------------------------|-----------------------------------|-------|
| `escort_threshold_width_ft`        | Number or NULL                    | When an escort is typically required |
| `escort_threshold_height_ft`       | Number or NULL                    | When an escort is typically required |
| `escort_threshold_length_ft`       | Number or NULL                    | When an escort is typically required |
| `curfew_restrictions`              | Text or NULL                      | Time, day, or holiday restrictions |
| `special_notes`                    | Text                              | Useful context for carriers (keep concise but specific) |

---

## Data Standards

- All dimensions are in **feet**.
- Weight is in **pounds**.
- Use `NULL` instead of the word `"None"`.
- `state_code` must always be the official 2-letter USPS code.
- Keep `special_notes` practical and actionable (avoid vague phrases like "Key corridor state").
- Always populate `source` and `last_updated`.

---

## Recommended Data Sources (in order of preference)

1. Official State DOT Oversize/Overweight Permitting website
2. State-specific permitting manuals or guides (PDFs)
3. FMCSA or federal oversize resources (for baseline)
4. Reputable third-party oversize permitting companies (with verification)
5. Direct contact with state permitting offices (for clarification)

---

## Example Row (Texas)

```sql
INSERT INTO state_permit_rules (
  state_code, state_name,
  legal_width_ft, legal_height_ft, legal_length_ft, legal_weight_lbs,
  permit_threshold_width_ft, permit_threshold_height_ft, 
  permit_threshold_length_ft, permit_threshold_weight_lbs,
  escort_threshold_width_ft, escort_threshold_height_ft, escort_threshold_length_ft,
  curfew_restrictions, special_notes, source, last_updated
) VALUES (
  'TX', 'Texas',
  8.5, 14.0, 53, 80000,
  8.5, 14.0, 53, 80000,
  10.0, 14.5, 110,
  'Night restrictions in some cities',
  'Very active OSOW state. High fees and complex permitting, especially in major metro areas.',
  'Texas DOT Oversize Manual 2025',
  NOW()
);
```

---

## Pre-Submission Checklist

- [ ] All required fields are filled
- [ ] `state_code` is the correct 2-letter abbreviation
- [ ] Numeric values use consistent units (feet / pounds)
- [ ] `source` clearly identifies where the data came from
- [ ] `last_updated` is set to current timestamp
- [ ] `curfew_restrictions` uses `NULL` instead of the word "None"
- [ ] `special_notes` is specific and useful (avoid vague phrases)

---

**Last Updated:** 2026-05-15
