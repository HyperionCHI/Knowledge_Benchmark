import { auth, currentSession } from "../../../lib/auth";
import { isAsciiPassword } from "../../../lib/credential-policy";

export async function POST(request: Request) {
  try {
    const session = await currentSession(request);
    if (!session?.user) return Response.json({ error: "请先登录。" }, { status: 401 });
    const body = await request.json() as { currentPassword?: string; newPassword?: string };
    if (!body.currentPassword) return Response.json({ error: "请输入旧密码。" }, { status: 400 });
    if (!body.newPassword || body.newPassword.length < 8) return Response.json({ error: "新密码至少需要 8 位。" }, { status: 400 });
    if (!isAsciiPassword(body.newPassword)) return Response.json({ error: "新密码只能使用半角英文、数字和符号。" }, { status: 400 });
    if (body.currentPassword === body.newPassword) return Response.json({ error: "新密码不能与旧密码相同。" }, { status: 400 });
    await auth.api.changePassword({
      headers: request.headers,
      body: { currentPassword: body.currentPassword, newPassword: body.newPassword, revokeOtherSessions: true },
    });
    return Response.json({ saved: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "密码修改失败";
    return Response.json({ error: /password|credential/i.test(message) ? "旧密码不正确。" : message }, { status: 400 });
  }
}
