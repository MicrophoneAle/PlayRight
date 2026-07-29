// MXLHelper is the only runtime OpenSheetMusicDisplay value this module needs,
// and only on the .mxl branch. Importing it statically would pull all ~1.25MB
// of OSMD back into the entry chunk and defeat the split in Dashboard.tsx.

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

/** Safe filename for a downloaded MusicXML export. */
export function musicXmlDownloadFilename(title: string): string {
  const sanitized = title
    .trim()
    // The C0 control range in this class is intentional: control characters,
    // along with the path metacharacters listed alongside them, are illegal in
    // filenames on Windows/macOS and must be stripped before the title is used
    // as a download filename.
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 120);

  return `${sanitized || 'score'}.musicxml`;
}

/** Trigger a browser download of a MusicXML string. */
export function downloadMusicXml(title: string, rawXml: string): void {
  const blob = new Blob([rawXml], {
    type: 'application/vnd.recordare.musicxml+xml;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = musicXmlDownloadFilename(title);
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Read a MusicXML or compressed MXL score file into a plain XML string. */
export async function readMusicXmlFromFile(file: File): Promise<string> {
  if (isMxlFile(file)) {
    const { MXLHelper } = await import('opensheetmusicdisplay');
    return MXLHelper.MXLtoXMLstring(file);
  }

  const text = await file.text();
  if (text.trim().length === 0) {
    throw new Error('The selected file is empty.');
  }

  return text;
}
