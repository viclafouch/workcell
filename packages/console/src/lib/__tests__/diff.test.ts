import { describe, expect, it } from 'vitest'
import { splitPatchByFile } from '#/lib/diff.ts'

const CHANGED = `diff --git a/src/one.ts b/src/one.ts
index 1111111..2222222 100644
--- a/src/one.ts
+++ b/src/one.ts
@@ -1 +1 @@
-old
+new`

const CREATED = `diff --git a/notes/new.md b/notes/new.md
new file mode 100644
--- /dev/null
+++ b/notes/new.md
@@ -0,0 +1 @@
+hello`

const DELETED = `diff --git a/gone.txt b/gone.txt
deleted file mode 100644
--- a/gone.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye`

describe('the whole diff of a branch', () => {
  it('keeps one patch per file, the first file included, under its path', () => {
    expect(
      splitPatchByFile([CHANGED, CREATED, DELETED].join('\n'))
    ).toStrictEqual([
      { path: 'src/one.ts', patch: `${CHANGED}\n` },
      { path: 'notes/new.md', patch: `${CREATED}\n` },
      { path: 'gone.txt', patch: DELETED }
    ])
  })

  it('finds no file in an empty diff', () => {
    expect(splitPatchByFile('')).toStrictEqual([])
  })
})
