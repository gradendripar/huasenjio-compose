<!--
 * @Autor: huasenjio
 * @Date: 2022-08-30 00:45:43
 * @LastEditors: huasenjio
 * @LastEditTime: 2023-03-21 00:10:42
 * @Description: 
-->
<template>
  <div
    id="js-home-head"
    class="home-head"
    :class="{
      clear: !showGrossGlass && headBgConfig.clear,
      white: headBgConfig.white,
      'gross-glass': showGrossGlass || headBgConfig.grossGlass,
    }"
    v-discolor
  >
    <section class="fold" @click="handleNavbar">
      <i class="iconfont icon-a-unfoldcross-line"></i>
    </section>
    <section class="menu" @click="handleMenu">
      <i class="iconfont icon-md-menu"></i>
    </section>
    <section v-if="showMenu" class="collapse">
      <ul class="links">
        <li v-for="(item, index) in links" :key="index" @click="jump(item, index)">
          <IconBox v-if="item.icon" size="16px" :icon="item.icon"></IconBox>
          <span class="text">{{ item.label }}</span>
        </li>
      </ul>
    </section>
    <section class="today">
      <div class="clock-group">
        <Clock></Clock>
      </div>
      <div class="weather-group">
        <Weather></Weather>
      </div>
    </section>
    <section v-if="showMenu" class="take">
      <el-dropdown class="dropdown" @command="handleSelectJournal" @visible-change="val => (showJournalDropdown = val)">
        <div class="journal__wrap">
          <div class="journal__name mr-px-4 text">
            {{ currentJournal.name || '无订阅源' }}
          </div>
          <i v-if="!showJournalDropdown" class="el-icon-arrow-down"></i>
          <i v-else class="el-icon-arrow-up"></i>
          <i class="el-icon-refresh ml-px-4 pointer" @click="handleSelectJournal(currentJournal._id)"></i>
        </div>
        <el-dropdown-menu class="journal-dropdown-menu" slot="dropdown">
          <template v-if="journals.length">
            <el-dropdown-item v-for="item in journals" :key="item._id" style="max-width: 124px" class="text" :title="item.name" :command="item._id">
              {{ item.name }}
            </el-dropdown-item>
          </template>
          <template v-else>
            <el-dropdown-item :disabled="true">
              空空如也
            </el-dropdown-item>
          </template>
        </el-dropdown-menu>
      </el-dropdown>
    </section>
    <section v-if="showMenu" class="sign" :title="user.id" @click="sign">
      {{ signText || `${user.id.slice(0, 4)}...` }}
    </section>
  </div>
</template>
<script>
import { mapState, mapMutations } from 'vuex';
import Clock from '@/components/common/clock/Clock.vue';
import Weather from '@/components/common/weather/Weather.vue';
import IconBox from '@/components/common/iconBox/IconBox.vue';
export default {
  name: 'HomeHead',

  components: {
    Clock,
    Weather,
    IconBox,
  },

  props: {
    headBgConfig: {
      type: Object,
      default: () => {
        return {
          clear: false,
          white: false,
          grossGlass: true,
        };
      },
    },
  },

  data() {
    return {
      showMenu: false,
      showJournalDropdown: false,
      selectedTake: '常用热门',
      takes: [],
      journals: [],
      currentJournal: {},
    };
  },

  computed: {
    ...mapState(['user']),
    showGrossGlass() {
      return this.showMenu && document.body.clientWidth <= 1024 ? true : false;
    },
    signText() {
      return this.user.token ? this.user.name : '注册登录';
    },
    links() {
      let site = this.$store.state.navConfig;
      return site;
    },
    // 默认选择的订阅源id，链接上携带的参数优先级最高
    defaultJournalId() {
      const { journal } = this.$route.query;
      if (journal) {
        return journal;
      } else {
        return this.STORAGE.getItem(this.CONSTANT.appJournal);
      }
    },
  },

  updated() {
    if (this.defaultJournalId) {
      this.handleHash(this.defaultJournalId);
    }
  },

  mounted() {
    this.querySites();
    this.queryJournals();
    this.initMenu();
  },

  methods: {
    ...mapMutations(['commitAll']),

    handleHash(_id) {
      let hash = location.hash.split('?')[0];
      location.hash = `${hash}?journal=${_id}`;
    },

    querySites() {
      this.API.Site.findSiteByCode({}, { notify: false }).then(res => {
        this.commitAll({
          sites: res.data,
        });
      });
    },

    // 请求订阅源
    queryJournals() {
      this.API.Journal.findJournal(
        {},
        {
          notify: false,
        },
      ).then(res => {
        if (res.data.length !== 0) {
          this.journals = res.data || [];
          this.handleSelectJournal(this.defaultJournalId || this.journals[0]._id);
        }
      });
    },

    handleSelectJournal(_id) {
      if (!_id) return;
      let exist = this.journals.find(item => item._id === _id);
      if (!exist) {
        this.$notify.warning('订阅源不存在，请您重新选择！');
      } else {
        this.API.Journal.findJournalInformationById({ _id }, { notify: false }).then(res => {
          this.selectJournal(res.data);
          // 保存当前选择的订阅源id
          this.STORAGE.setItem(this.CONSTANT.appJournal, _id);
          this.handleHash(_id);
        });
      }
    },

    selectJournal(journal) {
      this.currentJournal = journal;
      this.commitAll({
        categorySites: journal.series,
      });
    },

    handleNavbar() {
      this.commitAll({
        user: {
          config: {
            showNavbar: !this.user.config.showNavbar,
          },
        },
      });
      this.$store.dispatch('snapshoot', { paths: ['config.showNavbar'] });
    },

    // 登录用户
    sign() {
      if (this.user.token) {
        // 已经登录，打开个人中心面板
        this.commitAll({
          showWrapPerson: true,
        });
      } else {
        // 未登录，打开登录面板
        this.commitAll({
          showWrapSign: true,
        });
      }
    },

    // 折叠菜单
    handleMenu() {
      this.showMenu = !this.showMenu;
    },

    // 根据窗口宽度大于1024，则不折叠菜单
    initMenu() {
      let debounce = this.LODASH.debounce(
        () => {
          if (document.body.clientWidth > 1024) {
            this.showMenu = true;
          } else {
            this.showMenu = false;
          }
        },
        100,
        {
          leading: true,
          trailing: true,
        },
      );
      window.addEventListener('resize', debounce);
      this.$once('hook:beforeDestory', () => {
        window.removeEventListener('resize', debounce);
      });
      // 手动触发一次resize事件
      this.$nextTick(() => {
        let event = new Event('resize', { bubbles: true, cancelable: false });
        document.dispatchEvent(event);
      });
    },

    // 跳转
    jump(item, index) {
      let articleId;
      switch (item.type) {
        case 'link':
          this.TOOL.openPage(this.LODASH.get(item, 'typeConfig.url'), this.LODASH.get(item, 'typeConfig.target'));
          break;
        case 'article':
          articleId = this.LODASH.get(item, 'typeConfig.articleId');
          if (!articleId) return;
          this.TOOL.jumpToRead(this, articleId);
          break;
      }
    },
  },
};
</script>

<style lang="scss" scoped>
.home-head {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 75px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  color: var(--gray-50);
  z-index: 2;
  .fold {
    order: 1;
    width: 75px;
    height: 75px;
    display: flex;
    justify-content: center;
    align-items: center;
    i {
      font-size: 28px;
      cursor: pointer;
    }
  }
  .menu {
    display: none;
    i {
      cursor: pointer;
    }
  }
  .collapse {
    order: 3;
    .links {
      display: flex;
      align-items: center;
      li {
        margin-left: 12px;
        display: flex;
        align-items: center;
        span {
          display: inline-block;
          max-width: 86px;
        }
        cursor: pointer;
        &:first-of-type {
          margin-left: 0;
        }
      }
    }
  }
  .today {
    order: 4;
    height: 75px;
    display: flex;
    align-items: center;
    margin-left: 14px;
    margin-right: auto;
    .clock-group {
      order: 1;
    }
    .weather-group {
      order: 2;
      margin-left: 14px;
      max-width: 228px;
      display: flex;
      align-items: center;
    }
  }
  .take {
    order: 5;
    .dropdown {
      color: inherit;
      .journal__wrap {
        max-width: 120px;
        display: flex;
        align-items: center;
        .journal__name {
          flex: 1;
        }
      }
    }
  }
  .sign {
    order: 6;
    margin-left: 18px;
    margin-right: 22px;
    max-width: 100px;
    cursor: pointer;
  }
  i {
    color: inherit;
  }
}

.clear {
  background-color: transparent;
  i {
    color: inherit;
  }
}
.gross-glass {
  color: var(--gray-600) !important;
  background-color: var(--gray-o5) !important;
  backdrop-filter: blur(8px) !important;
  i {
    color: inherit;
  }
}
.white {
  color: var(--gray-700) !important;
  background-color: var(--gray-0) !important;
  i {
    color: inherit;
  }
}

@media only screen and (max-width: 1024px) {
  .home-head {
    width: 100%;
    height: auto;
    .fold {
      display: none;
    }
    .menu {
      order: 2;
      margin-right: 10px;
      display: block;
      i {
        font-size: 24px;
      }
    }
    .collapse {
      order: 3;
      width: 100%;
      .links {
        flex-direction: column;
        padding: 0px 15px;
        box-sizing: border-box;
        li {
          width: 100%;
          margin-top: 10px;
          margin-left: 0px;
        }
      }
    }
    .today {
      order: 1;
      margin: 0;
      margin-left: 10px;
      margin-right: auto;
      .clock-group {
        order: 1;
      }
      .weather-group {
        order: 2;
        margin-left: 4px;
      }
    }
    .take {
      order: 5;
      width: 100%;
      padding: 10px 30px;
      box-sizing: border-box;
    }
    .sign {
      order: 6;
      min-width: 100%;
      margin: 0;
      padding: 0px 30px 10px 30px;
      box-sizing: border-box;
    }
  }
}
</style>
