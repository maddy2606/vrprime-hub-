import type { ReactNode } from "react";

function Icon({ children, className = "h-6 w-6" }: { children: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

type IconProps = { className?: string };

export const InboxIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 13h4l1.5 3h5L16 13h4" />
    <path d="M5.5 5h13L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5z" />
  </Icon>
);

export const ListIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 6h12M8 12h12M8 18h12" />
    <path d="M4 6h.01M4 12h.01M4 18h.01" />
  </Icon>
);

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const TicketIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 8a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2a2 2 0 0 0 0 4v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a2 2 0 0 0 0-4z" />
    <path d="M14 7v10" strokeDasharray="2 2.5" />
  </Icon>
);

export const BoxIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
    <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
  </Icon>
);

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4 4" />
  </Icon>
);

export const UsersIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.5a6.5 6.5 0 0 1 3.5 5.5" />
  </Icon>
);

export const BackIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

export const CameraIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
    <circle cx="12" cy="13" r="3.5" />
  </Icon>
);

export const BellIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
    <path d="M10 20.5a2 2 0 0 0 4 0" />
  </Icon>
);

export const SlidersIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 6h14M5 12h14M5 18h14" />
    <circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" />
    <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
    <circle cx="8" cy="18" r="2" fill="currentColor" stroke="none" />
  </Icon>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);
