const STATUS = {
  pending:          { chip: 'chip-gray',   label: 'Pending'       },
  planning:         { chip: 'chip-violet', label: 'Planning'      },
  running:          { chip: 'chip-green',  label: 'Running'       },
  waiting_approval: { chip: 'chip-amber',  label: 'Needs Approval' },
  approved:         { chip: 'chip-green',  label: 'Approved'      },
  rejected:         { chip: 'chip-red',    label: 'Rejected'      },
  completed:        { chip: 'chip-green',  label: 'Completed'     },
  failed:           { chip: 'chip-red',    label: 'Failed'        },
  cancelled:        { chip: 'chip-gray',   label: 'Cancelled'     },
}

const LIVE = new Set(['running', 'planning'])

export function StatusBadge({ status, animate = false }) {
  const { chip, label } = STATUS[status] || STATUS.pending
  const isLive = animate && LIVE.has(status)

  return (
    <span className={chip}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', background: 'currentColor',
        flexShrink: 0, opacity: isLive ? 1 : 0.6,
        animation: isLive ? 'pulse 1.4s ease-in-out infinite' : 'none',
        boxShadow: isLive ? '0 0 6px currentColor' : 'none',
      }} />
      {label}
    </span>
  )
}
