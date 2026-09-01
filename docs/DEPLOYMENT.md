# 部署指南

## 本地生产模式

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

也可以运行构建生成的独立服务：

```bash
node dist/standalone/server.js
```

## 环境变量

生产环境至少需要：

```dotenv
BETTER_AUTH_SECRET=<至少 32 字节的随机值>
BETTER_AUTH_URL=https://knowledge.example.com
WORKBENCH_DB_PATH=/srv/knowledge-workbench/data/workbench.sqlite
WORKBENCH_ATTACHMENT_DIR=/srv/knowledge-workbench/data/attachments
PORT=3001
```

数据库和附件应放在发布目录之外的持久化路径。升级或替换构建产物时，不要覆盖这些目录。

## 反向代理与 HTTPS

生产环境建议使用 Caddy、Nginx、IIS 或同类反向代理提供 HTTPS，并转发 `Host`、`X-Forwarded-Proto` 与客户端 IP 相关头。

`BETTER_AUTH_URL` 必须与浏览器实际使用的协议、域名和端口一致。上传上限需要同时在反向代理和应用侧允许。

## 进程管理

可使用 systemd、PM2、Windows 服务管理器或容器编排工具守护服务。运行账号需要拥有数据库和附件目录的读写权限，并且只向预期网络开放端口。

## 升级流程

1. 备份并验证当前数据。
2. 在独立目录安装依赖并完成构建与测试。
3. 停止旧服务。
4. 切换到新构建，继续使用原持久化数据路径。
5. 启动服务并检查登录、文档、附件和权限。
6. 保留旧构建，直到确认可以回滚。

## Cloudflare/OpenAI Sites 说明

仓库保留了 Vinext Sites 配置，但当前应用使用本地 `better-sqlite3`、本地附件目录和应用自有账号体系，不能不经改造直接部署到无状态边缘环境。若要部署到 Sites/Cloudflare，应先把 SQLite 和附件分别迁移到平台持久化存储，并重新评估身份认证方案。
