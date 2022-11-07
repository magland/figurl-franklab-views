import { median } from 'mathjs'

// We will potentially be doing this a lot, and supposedly the good old for-loop is more
// performant than doing array-copy slicing and/or fancy reduce tricks.
const sumRange = (array: number[], startInclusive: number, endExclusive: number): number => {
    let end = Math.min(endExclusive, array.length) || 0
    let res = 0
    for (let i = startInclusive; i < end; i++) {
        res += array[i]
    }
    return res
}


export type DownsampledData = {
    downsampledValues: number[],
    downsampledPositions: number[],
    downsampledTimes: number[],
    scaleFactor: number
}


// // Currently unused. Would dynamically fit the visible time points into the available onscreen canvas.
// const dynamicDownsample = (values: number[], positions: number[], times: number[], framesPerPixel: number): DownsampledData => {
//     let runningTimeIndexTotal = 0
//     let nextUnprocessedTimeIndex = 0
//     let nextUnprocessedDataIndex = 0
//     const results: DownsampledData = { downsampledValues: [], downsampledPositions: [], downsampledTimes: [], scaleFactor: -1 }
//     while (runningTimeIndexTotal < times.length) {
//         runningTimeIndexTotal += framesPerPixel
//         const thisFrameLength = Math.floor(runningTimeIndexTotal - nextUnprocessedTimeIndex)
//         const dataIndicesThisSample = sumRange(times, nextUnprocessedTimeIndex, nextUnprocessedTimeIndex + thisFrameLength + 1)
//         const sampleData: Map<number, number> = new Map()
//         for (let i = nextUnprocessedDataIndex; i < i + dataIndicesThisSample; i++) {
//             const p = positions[i]
//             sampleData.set(p, (sampleData.get(p) ?? 0) + values[i])
//         }
//         results.downsampledTimes.push(sampleData.size)
//         sampleData.forEach((value, key) => {
//             results.downsampledPositions.push(key)
//             // The value for this spot will be the round-up average over the range of compressed time frames.
//             results.downsampledValues.push(Math.ceil(value / thisFrameLength))
//         })
//         nextUnprocessedDataIndex += dataIndicesThisSample
//         nextUnprocessedTimeIndex += thisFrameLength
//     }

//     return results
// }


export const computeScaleFactor = (baseScaleFactor: number, visibleRangeCount: number, maxRangeCount: number) => {
    // We want x, the smallest power of base s.t. (the visible range) * base^x > full range.
    // So if we have 2000 columns visible and can display up to 750, with base scaling of 3, we would need
    // to compress 27x (3^3) so that 27 native columns make up every display column.
    const exponent = Math.ceil(Math.log(visibleRangeCount/maxRangeCount)/Math.log(baseScaleFactor))
    return Math.max(Math.pow(baseScaleFactor, exponent), 1)
}


// TODO: query users about mean vs max for downsampling method
export const staticDownsample = (values: number[], positions: number[], times: number[], scaleFactor: number, mode: 'mean' | 'max' = 'mean'): DownsampledData => {
    const results: DownsampledData = { downsampledValues: [], downsampledPositions: [], downsampledTimes: [], scaleFactor }
    if (scaleFactor === 1) {
        return {downsampledValues: values, downsampledPositions: positions, downsampledTimes: times, scaleFactor: 1}
    }
    let firstUnfinishedDataPoint = 0
    for (let i = 0; i < times.length; i += scaleFactor) {
        const sampleData: Map<number, number> = new Map()
        const pointCountThisSample = sumRange(times, i, i + scaleFactor)
        for (let j = firstUnfinishedDataPoint; j < firstUnfinishedDataPoint + pointCountThisSample; j++) {
            const p = positions[j]
            if (mode === 'mean') {
                sampleData.set(p, (sampleData.get(p) ?? 0) + values[j])
            } else if (mode === 'max') {
                sampleData.set(p, Math.max(sampleData.get(p) ?? 0, values[j]))
            }
        }
        results.downsampledTimes.push(sampleData.size)
        sampleData.forEach((value, key) => {
            results.downsampledPositions.push(key)
            if (mode === 'mean') {
                results.downsampledValues.push(Math.ceil(value / scaleFactor))
            } else if (mode === 'max') {
                results.downsampledValues.push(Math.ceil(value))
            }
        })
        firstUnfinishedDataPoint += pointCountThisSample
    }
    return results
}


export const getDownsampledRange = (scaleFactor: number, firstSelected: number, lastSelected: number) => {
    // Assume native indices start from 0
    return {
        downsampledStart: Math.floor(firstSelected / scaleFactor),
        downsampledEnd: Math.ceil(lastSelected / scaleFactor)
    }
}


// TODO: Make sure we're using typed arrays for positions array.
export const downsampleObservedPositions = (scaleFactor: number, positions: number[]): number[] | undefined => {
    if (positions === undefined) return undefined
    if (scaleFactor < 1) {
        console.warn(`Attempt to use scale factor of less than 1 in downsampling observed position. Don't do that.`)
        return undefined
    }
    if (scaleFactor === 1) {
        return positions
    }
    const p: number[] = Array.from({length: Math.ceil(positions.length / scaleFactor)})
    p.forEach((value, index) => {
        p[index] = median(positions.slice(index * scaleFactor, (index + 1) * scaleFactor))
    })
    return p
}


export const getVisibleFrames = (_startTimeSec: number, _samplingFrequencyHz: number, dataLength: number, visibleTimeStartSeconds?: number, visibleTimeEndSeconds?: number) => {
    const _visibleStartTime = Math.max((visibleTimeStartSeconds ?? _startTimeSec), _startTimeSec)
    const firstFrame = Math.floor((_visibleStartTime - _startTimeSec) * _samplingFrequencyHz)
    const lastFrame = visibleTimeEndSeconds === undefined
        ? dataLength - 1
        : firstFrame + Math.floor((visibleTimeEndSeconds - (visibleTimeStartSeconds ?? 0)) * _samplingFrequencyHz)
    return { firstFrame, lastFrame }
}