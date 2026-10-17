import { expect, test } from 'claude-code/testing'

const PANE = {
  title: 'Flow',
  isFocused: true,
  bodyColumns: 64,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the flow pane draws its hotkey controls on ${surface}`, async $ => {
    const ui = await $.ui.mount({ plugin: 'flow-view', surface, component: 'Pane', requestId: 'flow-view', props: PANE })

    for (const key of ['ctl-finished', 'ctl-collapse', 'ctl-minimize', 'ctl-close']) {
      expect(await ui.find({ key })).toBeDefined()
    }
  })
}

const STATE_FILE = `---
Status: in_progress
Branch: lt/x
---
# X

Map: https://claude.ai/artifact/abc

## Steps
- [x] 1 frame · [x] 2 build · [ ] 3 trace (x2) · [x] 3f fix round · [ ] 4 ship

## Log
- 2026-10-02 [3f] fix round done: F1 applied. More detail.
`

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a run this session edits draws its steps and a clickable link on ${surface}`, async ($, on) => {
    const answer = (value: unknown) => async () => ({ value })
    on('process.run', answer({ exitCode: 0, stdout: '/repo/.git\n', stderr: '', isStdoutTruncated: false }))
    on('fs.stat', answer({ kind: 'file', size: STATE_FILE.length, mtimeMs: 0, isLink: false }))
    on('fs.read', answer(STATE_FILE))
    on('tool.call', async () => ({ result: { filePath: '/repo/docs/flow/lean/x.md' } }))
    for (const name of ['clock.now', 'clock.after', 'ui.status', 'ui.toast', 'ui.close', 'ui.panes', 'agent.list', 'session.messages'] as const) {
      on(name, answer(name === 'clock.now' ? 0 : name.endsWith('list') || name.endsWith('panes') || name.endsWith('messages') ? [] : undefined))
    }
    on('ui.open', answer({ isPlaced: true }))

    await $.tool.call({ tool: 'Edit', file_path: '/repo/docs/flow/lean/x.md', old_string: 'a', new_string: 'b' })
    await $.command.run({ command: 'flow-view', args: '' })
    const ui = await $.ui.mount({ plugin: 'flow-view', surface, component: 'Pane', requestId: 'flow-view', props: PANE })

    expect(await ui.find({ type: 'Markdown' })).toBe(undefined)
    await ui.press({ key: 'row-docs/flow/lean/x.md::1 frame' })
    expect(await ui.find({ type: 'Markdown' })).toBeDefined()

    expect(await ui.find({ text: /F1 applied/ })).toBe(undefined)

    await ui.press({ key: 'row-docs/flow/lean/x.md::3f fix round' })
    expect(await ui.find({ text: /fix round done: F1 applied/ })).toBeDefined()
  })
}
