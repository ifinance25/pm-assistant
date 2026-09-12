# Соглашения страниц wiki — PM Assistant

Читать при работе с `wiki/`. В каждом запросе не нужно.

## Язык

Страницу писать на языке основного источника или языка проекта. Wikilinks нейтральны к языку.

IT-термины — с русским аналогом в скобках при первом упоминании (пользователь не программист).

## Source page (`wiki/sources/<slug>.md`)

```markdown
---
type: source
date_ingested: YYYY-MM-DD
source_type: article | doc | transcript | pdf | note
language: en | ru | ...
original: raw/<filename>
---

# <Title>

## Summary
(2-4 sentences)

## Key Takeaways
- ...

## Relevant To
Optional wikilinks only if useful.

## Quotes / Excerpts
> ...
```

## Concept page (`wiki/concepts/<slug>.md`)

```markdown
---
type: concept
---

# <Concept Name>

## Definition

## Relevance to This Project

## Trade-offs / Nuances

## Related
Optional meaningful links.
```

## Entity page (`wiki/entities/<slug>.md`)

```markdown
---
type: entity
entity_type: tool | vendor | framework | person | product
---

# <Name>

## What It Is

## How It's Used in This Project

## Trade-offs / Nuances

## Related
Optional meaningful links.
```
