import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router'

const routes: Array<RouteRecordRaw> = [
  {
    path: '/:catchAll(.*)',
    redirect: { name: 'dashboard' },
  },
  {
    name: 'dashboard',
    path: '/',
    component: () => import('../pages/dashboard/DashboardPage.vue'),
  },
  {
    name: 'login',
    path: '/login',
    component: () => import('../pages/auth/login/Login.vue'),
  },
  {
    name: 'taxons',
    path: '/taxons',
    component: () => import('../pages/taxons/TaxonPage.vue'),
  },
  {
    name: 'taxon',
    path: '/taxons/:taxid',
    component: () => import('../pages/taxons/TaxonDetails.vue'),
    props:true
  },
  {
    path: '/assemblies',
    name: 'assemblies',
    component: () => import('../pages/assemblies/AssemblyPage.vue'),
  },
  {
    path: '/assemblies/:accession',
    name: 'assembly',
    props: true,
    component: () => import('../pages/assemblies/AssemblyDetails.vue'),
    meta: {
      name: 'assemblies',
    },
  },
  {
    path: '/annotations',
    name: 'annotations',
    component: () => import('../pages/genome-annotations/GenomeAnnotationPage.vue'),
  },
  {
    path: '/annotations/:name',
    name: 'annotation',
    props: true,
    component: () => import('../pages/genome-annotations/GenomeAnnotationDetails.vue'),
    meta: {
      name: 'assemblies',
    },
  },
  
  {
    name: 'organisms',
    path: '/organisms',
    component: () => import('../pages/organisms/OrganismPage.vue'),
  },
  {
    name: 'organism',
    path: '/organisms/:taxid',
    props: true,
    component: () => import('../pages/organisms/Organism.vue'),
    meta: {
      name: 'organisms',
    },
  }
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

export default router
