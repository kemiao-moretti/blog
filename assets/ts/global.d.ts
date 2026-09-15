export {};

declare global {
  // 第三方库的全局变量（CDN 脚本注入，无官方类型）
  const Snackbar: any;
  const mediumZoom: any;
  const LazyLoad: any;
  const Fancybox: any;
  const Swiper: any;
  const waterfall: any;
  const APlayer: any;
  // 页面内联脚本注入的函数（Hugo 模板生成）
  const loadTwoComment: any;
  const home_subtitle: any;
  const updatePostsBasedOnComments: any;

  interface Window {
    Solitude: Record<string, any>;
    globalFn: Record<string, any>;
    Chart?: any;
    echarts?: any;
    ABCJS?: any;
    mermaid?: any;
    TypeIt?: any;
    ColorThief?: any;
    lazyLoadInstance?: any;
    fancyboxRun?: boolean;
    meting_api?: string;
  }
}
