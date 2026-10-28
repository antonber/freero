// Freero design system — the only public entry into ui/ (import from '@ui').
// Importing this module also loads the design tokens and base styles.
import './tokens.css';
import './base.css';

export { Button, IconButton, ToolbarButton } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize, IconButtonProps, ToolbarButtonProps } from './Button';
export { Tooltip } from './Tooltip';
export type { TooltipProps } from './Tooltip';
export { Popover } from './Popover';
export type { PopoverProps } from './Popover';
export { Menu } from './Menu';
export type { MenuProps, MenuItem, MenuAction, MenuDivider, MenuHeading } from './Menu';
export { Modal } from './Modal';
export type { ModalProps } from './Modal';
export { Input, TextArea, Toggle, Slider } from './fields';
export type { InputProps, TextAreaProps, ToggleProps, SliderProps } from './fields';
export { Select } from './Select';
export type { SelectProps, SelectOption } from './Select';
export { ColorSwatches } from './ColorSwatches';
export type { ColorSwatchesProps } from './ColorSwatches';
export { Avatar, AvatarStack } from './Avatar';
export type { AvatarProps, AvatarStackProps, AvatarStackUser } from './Avatar';
export { Divider, Kbd, Spinner, Skeleton } from './misc';
export type { DividerProps, KbdProps, SpinnerProps, SkeletonProps } from './misc';
export { Logo } from './Logo';
export type { LogoProps } from './Logo';
export { ToastProvider, useToast } from './Toast';
export type { ToastApi, ToastKind, ToastOptions, NotifyFn } from './Toast';
export { SegmentedControl } from './SegmentedControl';
export type { SegmentedControlProps, SegmentedOption } from './SegmentedControl';

// Helpers
export { Icon, renderIcon } from './icon';
export type { IconProp } from './icon';
export { computePosition } from './position';
export type { Side, Align, Box, PositionInput, PositionResult } from './position';
export { formatShortcut, shortcutKeys, isApplePlatform } from './shortcut';
export { readableTextColor, initials } from './color';
export { useDismissableLayer, useFloatingPosition } from './layers';
