import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Input gating is structural: a modal blocks note/finger/shortcut input only
 * because ModalOverlay registers itself in the store while mounted. This guard
 * fails if a modal dialog is rendered without one, so a newly added modal
 * cannot silently leave keyboard input live behind its backdrop.
 */

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function listTsx(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return listTsx(path);
    }
    return path.endsWith('.tsx') ? [path] : [];
  });
}

function count(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

describe('modal overlay guard', () => {
  const files = listTsx(srcRoot).filter((path) => !path.endsWith('ModalOverlay.tsx'));

  it('renders every aria-modal dialog inside a ModalOverlay', () => {
    const offenders = files.flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      const dialogs = count(source, /aria-modal/g);
      const overlays = count(source, /<ModalOverlay\b/g);
      return dialogs > overlays
        ? [`${relative(srcRoot, path)}: ${dialogs} aria-modal, ${overlays} <ModalOverlay>`]
        : [];
    });

    expect(offenders).toEqual([]);
  });

  it('has no full-screen backdrop outside a ModalOverlay', () => {
    const offenders = files.flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      const backdrops = count(source, /\bfixed inset-0\b/g);
      const overlays = count(source, /<ModalOverlay\s+className="[^"]*\bfixed inset-0\b/g);
      return backdrops > overlays ? [relative(srcRoot, path)] : [];
    });

    expect(offenders).toEqual([]);
  });

  it('still sees the known modals (guard is not vacuous)', () => {
    const withOverlay = files.filter((path) =>
      /<ModalOverlay\b/.test(readFileSync(path, 'utf8')),
    );
    expect(withOverlay.length).toBeGreaterThanOrEqual(4);
  });
});
