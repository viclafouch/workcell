import { RuleTester } from 'oxlint/plugins-dev'
import { describe, it } from 'vitest'
import { noManualMemo } from '../plugin.ts'

// oxlint-disable-next-line typescript/strict-void-return -- the oxlint RuleTester docs assign the vitest describe as is
RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: { parserOptions: { lang: 'tsx' } }
})

ruleTester.run('no-manual-memo', noManualMemo, {
  valid: [
    {
      name: 'a derived value computed in render',
      code: 'const App = ({ items }) => { const count = items.length; return <p>{count}</p> }'
    },
    {
      name: 'another React hook',
      code: 'const App = () => { const [value] = React.useState(0); return <p>{value}</p> }'
    }
  ],
  invalid: [
    {
      name: 'React.useMemo',
      code: 'const App = ({ items }) => { const count = React.useMemo(() => items.length, [items]); return <p>{count}</p> }',
      errors: [{ messageId: 'manualMemo', data: { name: 'useMemo' } }]
    },
    {
      name: 'an imported useCallback',
      code: 'const App = () => { const onClick = useCallback(() => {}, []); return <p onClick={onClick} /> }',
      errors: [{ messageId: 'manualMemo', data: { name: 'useCallback' } }]
    },
    {
      name: 'memo around a component',
      code: 'const Row = memo(() => <li />)',
      errors: [{ messageId: 'manualMemo', data: { name: 'memo' } }]
    }
  ]
})
