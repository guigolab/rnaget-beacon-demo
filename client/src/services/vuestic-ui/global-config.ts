import VaIcon from './components/va-icon'
import iconsConfig from './icons-config/icons-config'

export default {
  colors: {
    variables: {
      primary: '#3891A6',
      secondary: '#4C5B5C',
      success: '#5EEB5B',
      info: '#A78682',
      danger: '#FF6663',
      warning: '#FF9B42',
    }
  },
  icons: iconsConfig,
  breakpoint: {
    enabled: true,
    bodyClass: true,
    thresholds: {
      xs: 0,
      sm: 320,
      md: 640,
      lg: 1024,
      xl: 1440,
    },
  },
  components: {
    VaIcon,
    VaButton: {
      round: true,
    },
    presets: {
      VaButton: {
        outline: {
          backgroundOpacity: 0,
          hoverBehaviour: 'opacity',
          hoverOpacity: 0.07,
          pressedBehaviour: 'opacity',
          pressedOpacity: 0.13,
        },
        plain: {
          round: false,
          plain: true,
          hoverBehaviour: 'mask',
          hoverOpacity: 0.15,
          pressedBehaviour: 'mask',
          pressedOpacity: 0.13,
        },
      },
    },
  },
}
