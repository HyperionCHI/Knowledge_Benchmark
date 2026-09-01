"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Locale = "zh" | "en";

const messages = {
  zh: {
    workspace: "工作空间", search: "全局搜索", admin: "管理后台", settings: "个人设置", signOut: "退出登录",
    systemLanguage: "中文", enter: "进入模块", selectBrand: "选择品牌", selectProduct: "选择产品线",
    back: "返回", profile: "个人资料", security: "账号安全", save: "保存", cancel: "取消",
    name: "显示名称", username: "登录账号", role: "账号角色", currentPassword: "旧密码",
    newPassword: "新密码", confirmPassword: "确认新密码", changePassword: "修改密码",
    docs: "通用资料与规章制度", sop: "品牌 / 产品 SOP", tracker: "项目跟踪表格索引",
    otherDocs: "其它资料", terms: "行业术语库", templates: "通用附件及模板",
    currentBrand: "当前品牌", openProducts: "查看产品线", basicInfo: "基本信息", passwordSettings: "修改密码",
    saveProfile: "保存基本信息", passwordHint: "新密码至少 8 位；修改后其它设备上的登录会话将失效。",
  },
  en: {
    workspace: "Workspace", search: "Search", admin: "Admin", settings: "Personal settings", signOut: "Sign out",
    systemLanguage: "English", enter: "Open module", selectBrand: "Select a brand", selectProduct: "Select a product",
    back: "Back", profile: "Profile", security: "Account security", save: "Save", cancel: "Cancel",
    name: "Display name", username: "Username", role: "Role", currentPassword: "Current password",
    newPassword: "New password", confirmPassword: "Confirm new password", changePassword: "Change password",
    docs: "Documents & Policies", sop: "Brand / Product SOP", tracker: "Project Trackers",
    otherDocs: "Other Documents", terms: "Terminology", templates: "Attachments & Templates",
    currentBrand: "Current brand", openProducts: "View products", basicInfo: "Basic information", passwordSettings: "Change password",
    saveProfile: "Save profile", passwordHint: "Use at least 8 characters. Other signed-in devices will be signed out after the change.",
  },
} as const;

type Key = keyof typeof messages.zh;
type I18nValue = { locale: Locale; setLocale: (value: Locale) => void; t: (key: Key) => string };
const I18nContext = createContext<I18nValue>({ locale: "zh", setLocale: () => undefined, t: (key) => messages.zh[key] as string });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => typeof window !== "undefined" && localStorage.getItem("workbench-locale") === "en" ? "en" : "zh");
  useEffect(() => { document.documentElement.lang = locale === "zh" ? "zh-CN" : "en"; }, [locale]);
  const value = useMemo(() => ({ locale, setLocale: (next: Locale) => { setLocale(next); localStorage.setItem("workbench-locale", next); }, t: (key: Key) => messages[locale][key] as string }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() { return useContext(I18nContext); }
