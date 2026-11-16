import { Fragment, type ReactNode } from 'react';

/**
 * Small Markdown renderer that builds React elements directly (never innerHTML, so no XSS).
 * Supports headings, paragraphs, bold/italic/strike, inline code, links (http/https/mailto only),
 * ordered and unordered lists, task lists, blockquotes, horizontal rules, tables, and fenced
 * code blocks with light syntax highlighting.
 */

// ---------- inline ----------
const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)|(~~[^~]+~~)|(\[[^\]]+\]\([^)\s]+\))|(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g;

function safeHref(href: string): string | null {
  return /^(https?:|mailto:)/i.test(href) ? href : null;
}

export function inline(text: string, keyBase = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${k++}`;
    if (m[1]) out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    else if (m[2] || m[3]) out.push(<strong key={key}>{inline(tok.slice(2, -2), key)}</strong>);
    else if (m[4] || m[5]) out.push(<em key={key}>{inline(tok.slice(1, -1), key)}</em>);
    else if (m[6]) out.push(<del key={key}>{inline(tok.slice(2, -2), key)}</del>);
    else if (m[7]) {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)!;
      const href = safeHref(lm[2]);
      out.push(href ? <a key={key} href={href} target="_blank" rel="noopener noreferrer">{inline(lm[1], key)}</a> : <span key={key}>{lm[1]}</span>);
    } else if (m[8]) out.push(<a key={key} href={tok} target="_blank" rel="noopener noreferrer">{tok}</a>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// ---------- syntax highlighting ----------
const KEYWORDS = new Set(('if else elif fi then do done for while case esac function return in import from export const let var def class '
  + 'true false null none yes no on off async await try catch finally new sudo echo cd apt systemctl docker compose services image ports volumes environment').split(' '));

export function highlight(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(#[^\n]*|\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(\b\d+(?:\.\d+)*\b)|([A-Za-z_][\w-]*)/g;
  let last = 0, k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    if (m.index > last) out.push(code.slice(last, m.index));
    const t = m[0];
    if (m[1]) out.push(<span key={k++} className="tok-c">{t}</span>);
    else if (m[2]) out.push(<span key={k++} className="tok-s">{t}</span>);
    else if (m[3]) out.push(<span key={k++} className="tok-n">{t}</span>);
    else if (KEYWORDS.has(t.toLowerCase())) out.push(<span key={k++} className="tok-k">{t}</span>);
    else out.push(t);
    last = m.index + t.length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

// ---------- blocks ----------
interface Opts { onToggleTask?: (line: number, checked: boolean) => void }

export function Markdown({ source, onToggleTask }: { source: string } & Opts) {
  return <div className="prose-rm">{blocks(source, { onToggleTask })}</div>;
}

function blocks(src: string, opts: Opts): ReactNode[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    // fenced code
    const fence = /^```\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(<pre key={key++} data-lang={fence[1] || undefined}><code>{highlight(body.join('\n'))}</code></pre>);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = Math.min(h[1].length, 3);
      const Tag = (`h${level}`) as 'h1' | 'h2' | 'h3';
      out.push(<Tag key={key++}>{inline(h[2], `h${key}`)}</Tag>);
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push(<hr key={key++} className="my-3 border-slate-300 dark:border-slate-700" />); i++; continue; }
    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
      out.push(<blockquote key={key++}>{blocks(body.join('\n'), opts)}</blockquote>);
      continue;
    }
    // table: header | sep | rows
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push(
        <table key={key++}>
          <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, `th${j}`)}</th>)}</tr></thead>
          <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `td${ri}-${j}`)}</td>)}</tr>)}</tbody>
        </table>,
      );
      continue;
    }
    // lists (one level; nested items are indented visually)
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
    if (li.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && li.test(lines[i])) {
        const [, indent, , text] = li.exec(lines[i])!;
        const task = /^\[([ xX])\]\s+(.*)$/.exec(text);
        const lineNo = i;
        const pad = Math.min(3, Math.floor(indent.length / 2));
        items.push(task ? (
          <li key={i} className="task" style={pad ? { marginLeft: `${pad * 1.25}rem` } : undefined}>
            <label className="inline-flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={task[1] !== ' '} disabled={!opts.onToggleTask}
                onChange={(e) => opts.onToggleTask?.(lineNo, e.target.checked)} />
              <span className={task[1] !== ' ' ? 'text-slate-500 line-through' : undefined}>{inline(task[2], `t${i}`)}</span>
            </label>
          </li>
        ) : <li key={i} style={pad ? { marginLeft: `${pad * 1.25}rem` } : undefined}>{inline(text, `l${i}`)}</li>);
        i++;
      }
      out.push(ordered ? <ol key={key++}>{items}</ol> : <ul key={key++}>{items}</ul>);
      continue;
    }
    // paragraph
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>|\s*([-*+]|\d+[.)])\s)/.test(lines[i])) para.push(lines[i++]);
    out.push(<p key={key++}>{para.map((p, j) => <Fragment key={j}>{j > 0 && <br />}{inline(p, `p${key}-${j}`)}</Fragment>)}</p>);
  }
  return out;
}

/** Toggle the checkbox of a task list item on a given source line. */
export function toggleTaskLine(src: string, line: number, checked: boolean): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  lines[line] = lines[line].replace(/\[([ xX])\]/, checked ? '[x]' : '[ ]');
  return lines.join('\n');
}
