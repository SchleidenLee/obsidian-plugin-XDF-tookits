import type { App, TFolder } from "obsidian";
import { jsonList, type XdfDb } from "./db";
import { readFile, writeFile } from "./markdown";
import {
  CLASS_TIME_SLOTS,
  INDEX_HEADER,
  LINK_NEXT,
  VIP_TIME_SLOTS,
  appendCourseTypeLine,
  appendLinkBeforeDivider,
  appendLinkListEntry,
  appendTestFeedbackLink,
  buildArchiveBody,
  buildArchiveFrontmatterFields,
  buildClassFeedback,
  buildFrontmatter,
  buildIndexLink,
  buildLessonFolderName,
  buildNav,
  buildPersonFeedback,
  getLessonFileNames,
  insertNewCourseTypeBlock,
  parseDateTime,
  updateArchiveTimestamps,
} from "./templates";

export type ArchiveKind = "class" | "vip";

export interface ArchiveInfo {
  found: boolean;
  kind: ArchiveKind | null;
  subject: string | null;
  schedule_type: string | null;
  course_types: string[];
  students: string[];
  archive_path: string;
  parent_folder: string;
  db_max_lesson: number;
}

function asFolder(app: App, path: string): TFolder | null {
  const f = app.vault.getAbstractFileByPath(path);
  if (f && "children" in f) return f as TFolder;
  return null;
}

export function nextLessonNumber(app: App, parentFolder: string, name: string, dbMax: number): number {
  let maxNum = dbMax || 0;
  const folder = asFolder(app, parentFolder);
  const re = new RegExp("^" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s+Lesson\\s+(\\d+)$", "i");
  if (folder) {
    for (const child of folder.children) {
      const m = child.name.match(re);
      if (m) maxNum = Math.max(maxNum, Number(m[1]));
    }
  }
  return maxNum + 1;
}
