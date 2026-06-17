import { MXLHelper } from 'opensheetmusicdisplay';

function isMxlFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  return (
    lowerName.endsWith('.mxl') ||
    file.type === 'application/vnd.recordare.musicxml+xml'
  );
}

export function titleFromFileName(fileName: string): string {
  return fileName.replace(/\.(musicxml|xml|mxl)$/i, '');
}

/** Read a MusicXML or compressed MXL score file into a plain XML string. */
export async function readMusicXmlFromFile(file: File): Promise<string> {
  if (isMxlFile(file)) {
    return MXLHelper.MXLtoXMLstring(file);
  }

  const text = await file.text();
  if (text.trim().length === 0) {
    throw new Error('The selected file is empty.');
  }

  return text;
}
