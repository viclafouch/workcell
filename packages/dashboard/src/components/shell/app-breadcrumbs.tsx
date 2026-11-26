import { Link, useMatches } from '@tanstack/react-router'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from '#/components/ui/breadcrumb.tsx'

type Crumb = {
  id: string
  label: string
  pathname: string
}

const matchIsCrumbData = (value: unknown): value is { crumb: string } => {
  return (
    typeof value === 'object' &&
    value !== null &&
    'crumb' in value &&
    typeof value.crumb === 'string'
  )
}

export const AppBreadcrumbs = () => {
  const crumbs = useMatches({
    select: (matches) => {
      return matches.flatMap(
        ({ id, pathname, loaderData, staticData }): Crumb[] => {
          const label = matchIsCrumbData(loaderData)
            ? loaderData.crumb
            : staticData.crumb

          return label === undefined ? [] : [{ id, label, pathname }]
        }
      )
    }
  })
  const section = useMatches({
    select: (matches) => {
      return matches.findLast(({ staticData }) => {
        return staticData.section !== undefined
      })?.staticData.section
    }
  })

  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        {section === undefined ? null : (
          <>
            <BreadcrumbItem className="max-sm:hidden">{section}</BreadcrumbItem>
            <BreadcrumbSeparator className="max-sm:hidden" />
          </>
        )}
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1

          return (
            <BreadcrumbItem key={crumb.id} className="min-w-0">
              {isLast ? (
                <BreadcrumbPage className="truncate">
                  {crumb.label}
                </BreadcrumbPage>
              ) : (
                <>
                  <BreadcrumbLink render={<Link to={crumb.pathname} />}>
                    {crumb.label}
                  </BreadcrumbLink>
                  <BreadcrumbSeparator />
                </>
              )}
            </BreadcrumbItem>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
