"use client";

import { MorphIcon } from "morphicons/react";
import {
  AppWindow, Badge, BookOpen, Boxes, BriefcaseBusiness, Building2, Check, ChevronDown,
  ChevronLeft, ChevronRight, CircleGauge, ClipboardCopy, Cloud, Code2, Database,
  Download, Edit3, ExternalLink, Eye, EyeOff, FileText, Folder, FolderPlus, Gem,
  Globe2, GripVertical, Headphones, HeartHandshake, ImagePlus, Info, Laptop,
  Languages, LayoutTemplate, Lightbulb, ListChecks, LogOut, Megaphone, Menu,
  Package, Palette, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Rocket, Save,
  Search, Settings, ShieldCheck, ShoppingBag, Smartphone, Sparkles, Target, Trash2,
  Upload, UserCog, UserRound, Users, X, type IconNode,
} from "lucide";

export const workspaceIcons: Record<string, IconNode> = {
  building: Building2, briefcase: BriefcaseBusiness, package: Package, boxes: Boxes,
  rocket: Rocket, target: Target, app: AppWindow, laptop: Laptop, phone: Smartphone,
  shopping: ShoppingBag, database: Database, cloud: Cloud, code: Code2, globe: Globe2,
  palette: Palette, shield: ShieldCheck, ideas: Lightbulb, service: HeartHandshake,
  audio: Headphones, marketing: Megaphone, premium: Gem, badge: Badge,
  dashboard: CircleGauge, sparkle: Sparkles, book: BookOpen,
  docs: FileText, clipboard: ClipboardCopy, other: Boxes, sop: ListChecks, tracker: CircleGauge, terms: BookOpen, templates: LayoutTemplate,
};

export const actionIcons: Record<string, IconNode> = {
  add: Plus, close: X, search: Search, admin: ShieldCheck, language: Languages,
  user: UserRound, settings: Settings, signOut: LogOut, edit: Edit3, delete: Trash2,
  copy: ClipboardCopy, drag: GripVertical, open: ExternalLink, download: Download,
  save: Save, back: ChevronLeft, next: ChevronRight, expand: ChevronDown, menu: Menu,
  collapsePanel: PanelLeftClose, expandPanel: PanelLeftOpen, folder: Folder,
  addFolder: FolderPlus, upload: Upload, uploadImage: ImagePlus, info: Info,
  show: Eye, hide: EyeOff, refresh: RefreshCw, users: Users, userSettings: UserCog,
  check: Check,
};

export const iconChoices = Object.keys(workspaceIcons).filter((name) => !["docs", "other", "sop", "tracker", "terms", "templates"].includes(name));

type IconProps = { name?: string; size?: number; strokeWidth?: number; className?: string; label?: string };

export function WorkspaceIcon({ name, size = 20, strokeWidth = 1.8, className, label }: IconProps) {
  // eslint-disable-next-line @next/next/no-img-element -- uploaded internal icons are served from the local attachment API.
  if (name?.startsWith("custom:")) return <img className={`custom-workspace-icon ${className || ""}`} src={name.slice(7)} alt={label || ""} width={size} height={size} />;
  const icon = workspaceIcons[name || "package"] || Package;
  return <MorphIcon icon={icon} size={size} strokeWidth={strokeWidth} className={className} label={label} reducedMotion="user" />;
}

export function ActionIcon({ name, size = 17, strokeWidth = 1.9, className, label }: IconProps) {
  const icon = actionIcons[name || "info"] || Info;
  return <MorphIcon icon={icon} size={size} strokeWidth={strokeWidth} className={className} label={label} reducedMotion="user" />;
}
