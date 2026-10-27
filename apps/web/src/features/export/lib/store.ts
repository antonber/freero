// Which export dialog is open. Commands run outside React, so they flip this tiny store and the
// screen-overlay panel renders the matching Modal.
import { create } from 'zustand';

export type ExportDialog = 'image' | 'pdf' | null;

export const useExportDialog = create<{ open: ExportDialog }>(() => ({ open: null }));

export const openExportDialog = (open: ExportDialog) => useExportDialog.setState({ open });
