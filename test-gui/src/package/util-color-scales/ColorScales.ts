export type ValidColorMap =  'inferno' | 'magma' | 'plasma' | 'viridis'
import { inferno, magma, plasma, viridis } from 'scale-color-perceptual'

export type ColorStyleSet8Bit = {
    colorStyles: string[],
    contrastColorStyle: string
}

export const DARK_DOVE_GREY = 'rgb(119, 118, 114)'

// Complement colors come from https://www.learnui.design/tools/accessible-color-generator.html
// Complement for viridis 0 (#440154) and 255 (#fbe723) is #4AC4E2, though that's not a great contrast with the midrange
// of that scale (around #228b8d) so maybe look for a different one?
// Complement for magma 0 (#000004) and 255 (#fcfbbd) is #6d70a9
// Complement for inferno 0 (#000004) and 255 (#fafda1) is #6667bd
// Complement for plasma 0 (#0d0887) and 255 (#f0f724) is #3c90c0, but consider #40cdff or #4597c7
// Complement for default (whose 0 is #00003c) is #7361ff
const ColorScaleContrastColors = {
    'viridis': '#4ac4e2',
    'magma': '#6d70a9',
    'inferno':  '#6667bd',
    'plasma': '#3c90c0'
}

// TODO: Get this from context? Or get the rangeMax from context? Or something?
export const useColorStyles8Bit = (rangeMax: number = 128, map?: ValidColorMap): ColorStyleSet8Bit => {
    const fn = (v: number | undefined): string => {
        if (v === undefined) return "rgba(0, 0, 0, 0)"
        const v_effective = Math.min(1, v/rangeMax)
        switch (map) {
            case 'inferno':
                return inferno(v_effective)
            case 'magma':
                return magma(v_effective)
            case 'plasma':
                return plasma(v_effective)
            case 'viridis':
                return viridis(v_effective)
            default:
                const proportion = (v)
                const intensity = Math.max(0, Math.min(255, Math.floor((255/rangeMax) * proportion)))
                return `rgba(${intensity}, ${intensity}, 60, 255)`
        }
    }
    const styles = Array.from({length: 256}).map((v, i) => fn(i))
    return { colorStyles: styles, contrastColorStyle: map === undefined ? '#7361ff' : ColorScaleContrastColors[map] }
}