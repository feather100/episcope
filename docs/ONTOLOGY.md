# Ontology Model (ids-onto)

EpiScope models report-card data with a Palantir-Foundry-style ontology
(ontology/ontology.json), separating **semantics** from raw CSV columns.

## Object Types

| ID | Display | Primary Key | Representative Properties |
|---|---|---|---|
| Case | 病例/报告卡 | card_id | onset_date, diag_time, case_class, disease_name, audit_status |
| Person | 患者 | person_key | name(PII), sex, birth_date, age, work_unit, crowd |
| Disease | 疾病 | disease_id | name, icd10, doid |
| Organization | 报告机构 | org_id | name, org_type, region_code |
| Address | 现住地址 | address_id | national_code, detail(PII), patient_belongs |
| User | 填报/审核用户 | user_id | fill_doctor, record_user, correct_user |

## Link Types

| ID | From → To |
|---|---|
| diagnoses | Case → Disease |
| reported_by | Case → Organization |
| involves | Case → Person |
| resides_at | Person → Address |
| created_by | Case → User |
| corrects | Case → Case |

## Action Types

| ID | Description |
|---|---|
| correct | 订正：修改病例关键字段并产生订正卡 |
| final_review | 终审：县/市/省三级审核 |
| mark_delete | 删除/标注：删除或标注不纳入统计 |

## Source Mapping

sourceSchemas[0].columnMapping maps all 45 columns of the Chinese
notifiable-disease report card to Object.property. The loader and frontend
both consume this mapping, so new source schemas can be added without code
changes.

## Privacy

PII properties (name, phone, detail, guardian) are tagged "pii": true
in the ontology — they are used only for internal dedupe / address parsing,
never persisted, and never included in analysis output.
