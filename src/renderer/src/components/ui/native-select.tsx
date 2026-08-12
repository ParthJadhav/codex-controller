import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../lib/utils'

export const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.ComponentProps<'select'>
>(({ className, children, ...props }, ref) => (
  <span className="ui-native-select-shell">
    <select ref={ref} className={cn('ui-native-select', className)} {...props}>
      {children}
    </select>
    <ChevronDown size={14} aria-hidden="true" />
  </span>
))
NativeSelect.displayName = 'NativeSelect'
