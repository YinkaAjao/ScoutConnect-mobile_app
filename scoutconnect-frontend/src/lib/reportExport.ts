// src/lib/reportExport.ts
import { Alert } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { buildReportHtml, ReportInput } from './report';

/** Turns whatever the print/share modules threw into something a scout can act on; the raw error only goes to the log. */
const friendlyReason = (e: unknown): string => {
  const raw = e instanceof Error ? e.message : String(e ?? '');
  // A native module missing means this installed build predates the feature: nothing the user can fix by retrying.
  if (/native module|ExpoPrint|ExpoSharing|not available|is not a function|undefined/i.test(raw)) {
    return 'PDF reports are not available in this version of the app yet. Please update the app and try again.';
  }
  return 'Something went wrong while preparing the PDF. Please try again in a moment.';
};

/** Renders the report to a PDF on the phone (works offline) and opens the share sheet so it can be saved or sent. */
export const shareReportPdf = async (input: ReportInput): Promise<void> => {
  try {
    if (!(await Sharing.isAvailableAsync())) {
      Alert.alert("Can't share the report", 'Sharing files is not supported on this device, so the PDF cannot be saved or sent from here.');
      return;
    }
    const { uri } = await Print.printToFileAsync({ html: buildReportHtml(input) });
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: `${input.name} – ScoutConnect report` });
  } catch (e) {
    if (/cancel|dismiss/i.test(e instanceof Error ? e.message : String(e))) return; // closing the share sheet is not an error
    console.warn('PDF report failed:', e);
    Alert.alert("Couldn't create the report", friendlyReason(e));
  }
};
