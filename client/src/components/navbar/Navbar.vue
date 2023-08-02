<template>
  <div class="app-layout-navbar">
    <div class="left">
      <va-icon-menu-collapsed :class="{ 'x-flip': isSidebarMinimized }" class="va-navbar__item" :color="colors.primary"
        @click="isSidebarMinimized = !isSidebarMinimized" />
    </div>
    <div class="center">
      <h2 class="va-h3 va-navbar__item">Geneid</h2>
    </div>
    <div class="right">
      <app-navbar-actions class="app-navbar__actions md5 lg4" :user-name="userName" />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useGlobalStore } from '../../stores/global-store'
import { useI18n } from 'vue-i18n'
import { useColors } from 'vuestic-ui'
import VaIconMenuCollapsed from '../icons/VaIconMenuCollapsed.vue'
import AppNavbarActions from './components/AppNavbarActions.vue'

const GlobalStore = useGlobalStore()
const { t } = useI18n()

const { isSidebarMinimized, userName } = storeToRefs(GlobalStore)

const { getColors } = useColors()
const colors = computed(() => getColors())
</script>

<style lang="scss" scoped>

h2 {
  color: var(--va-primary);
  margin: 0;
}

.app-layout-navbar{
  display: flex;
  place-items: center;
  justify-content: space-between;
  gap: 1rem;
  box-shadow: var(--va-box-shadow);
  z-index: 2;
  padding: .75rem;

}

.x-flip {
  transform: scaleX(-100%);
}

</style>
