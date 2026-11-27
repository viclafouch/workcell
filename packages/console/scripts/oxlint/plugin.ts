import { defineRule, eslintCompatPlugin, type ESTree } from '@oxlint/plugins'

const LINK_ELEMENT_NAMES = new Set(['Link', 'a'])

function findAttribute(element: ESTree.JSXOpeningElement, name: string) {
  return (
    element.attributes.find((attribute) => {
      return (
        attribute.type === 'JSXAttribute' &&
        attribute.name.type === 'JSXIdentifier' &&
        attribute.name.name === name
      )
    }) ?? null
  )
}

function matchIsFalseAttribute(attribute: ESTree.Node | null) {
  return (
    attribute?.type === 'JSXAttribute' &&
    attribute.value?.type === 'JSXExpressionContainer' &&
    attribute.value.expression.type === 'Literal' &&
    attribute.value.expression.value === false
  )
}

function findRenderedLinkName(attribute: ESTree.Node | null) {
  if (
    attribute?.type !== 'JSXAttribute' ||
    attribute.value?.type !== 'JSXExpressionContainer' ||
    attribute.value.expression.type !== 'JSXElement'
  ) {
    return null
  }
  const { name } = attribute.value.expression.openingElement
  return name.type === 'JSXIdentifier' && LINK_ELEMENT_NAMES.has(name.name)
    ? name.name
    : null
}

export const noLinkAsButton = defineRule({
  meta: {
    type: 'problem',
    messages: {
      linkAsButton:
        'Render the `<{{element}}>` itself, styled as a button: `nativeButton={false}` gives it the `button` role, so a screen reader announces a button instead of a link.'
    },
    schema: []
  },
  createOnce(context) {
    return {
      JSXOpeningElement(node) {
        if (!matchIsFalseAttribute(findAttribute(node, 'nativeButton'))) {
          return
        }
        const renderAttribute = findAttribute(node, 'render')
        const element = findRenderedLinkName(renderAttribute)
        if (renderAttribute && element) {
          context.report({
            node: renderAttribute,
            messageId: 'linkAsButton',
            data: { element }
          })
        }
      }
    }
  }
})

const MANUAL_MEMO_NAMES = new Set(['useMemo', 'useCallback', 'memo'])

function findCalleeName(callee: ESTree.Node) {
  if (callee.type === 'Identifier') {
    return callee.name
  }
  if (
    callee.type === 'MemberExpression' &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'React' &&
    callee.property.type === 'Identifier'
  ) {
    return callee.property.name
  }
  return null
}

export const noManualMemo = defineRule({
  meta: {
    type: 'suggestion',
    messages: {
      manualMemo:
        'Drop `{{name}}`: the React Compiler memoizes every component and hook of the page.'
    },
    schema: []
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        const name = findCalleeName(node.callee)
        if (name !== null && MANUAL_MEMO_NAMES.has(name)) {
          context.report({ node, messageId: 'manualMemo', data: { name } })
        }
      }
    }
  }
})

export default eslintCompatPlugin({
  meta: { name: 'workcell-console' },
  rules: {
    'no-link-as-button': noLinkAsButton,
    'no-manual-memo': noManualMemo
  }
})
