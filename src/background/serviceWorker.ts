// MV3 service worker 진입점.
// 모든 이벤트 리스너는 SW 재기동 시 이벤트 유실을 막기 위해 여기서 동기적으로 등록한다.
import { registerBadge } from './badge';
import { registerMessageRouter } from './messageRouter';
import { registerNetworkDetector } from './networkDetector';
import { registerTabLifecycle } from './tabLifecycle';

registerMessageRouter();
registerNetworkDetector();
registerTabLifecycle();
registerBadge();
