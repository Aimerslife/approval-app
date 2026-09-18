import PocketBase from 'pocketbase';

// PocketBase 服务地址。
// 默认用当前站点 origin（同源请求走 Vite 代理 /api → 8091，见 vite.config.mts），
// 避免浏览器直连 8091 触发 CORS；
// 部署时若 PB 与前端不同域，再通过 VITE_PB_URL 显式指定绝对地址并配置 PB 的 CORS。
const PB_URL = import.meta.env.VITE_PB_URL || window.location.origin;
export const pb = new PocketBase(PB_URL);

pb.authStore.loadFromCookie(document.cookie);

// 监听登录状态变化，同步写入cookie（页面刷新保持登录）
pb.authStore.onChange((token, model) => {
  document.cookie = pb.authStore.exportToCookie({ httpOnly: false });
});

export default pb;