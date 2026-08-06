---
name: okf
description: how to generate okf wiki
---

## wiki folder structure

```
wiki/
├── index.md
├── commands/
|   ├── index.md
│   ├── create.md
│   ├── push.md
│   ├── pull.md
│   └── ...
└── roadmap.md
```

## wiki markdown format

```markdown
---
type: <type>
title: <title>
description: <description>
tags: [<tag1>, <tag2>]
created at: <YYYY-MM-DD> <HH:MM:SS>
changed at: <YYYY-MM-DD> <HH:MM:SS>
---

# <command title>

<command description>

## Usage

```bash
<command usage>
```

## Options

- `<option>`: <option description>

## Examples

```bash
<command example>
```

## Expected Output

```json
<command expected output>
```

# More

## fixme

- [ ] <issue description>

## todo

- [ ] <task description>

# references

```