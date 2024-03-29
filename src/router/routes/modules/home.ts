import type { RouteRecordRaw } from 'vue-router';

import { asyncViewImport } from '/@/router/helper/asyncViewImport';

const home: RouteRecordRaw = {
  path: '/home',
  name: 'home',
  meta: {
    title: 'P2P视频通话',
    hideTitleSuffix: true,
    public: true
  },
  component: asyncViewImport('home/index.vue')
};

export default home;
