import { BstSearchFn, BstSearchResult, useBinarySearchTree } from "@figurl/core-utils"
// import React, { useCallback, useMemo, useRef } from "react"
// import { AnimationState, AnimationStateAction } from "../../util-animation"
// import { DebounceThrottleResolver, DebounceThrottleUpdater, useThrottler } from "../../util-rate-limiters"
import React, { useCallback, useMemo, useRef } from "react"
import { AnimationState, AnimationStateAction } from "../../util-animation"


type TimeLookupFn = (time: number) => BstSearchResult<number> | undefined
// type debounceUpdateRefs = { targetExternalTimeRef: React.MutableRefObject<number | undefined> }
// type debounceUpdateProps = { currentTime: number | undefined }
// type debounceUpdateResolverProps = { committer: (time: number | undefined, setTimeFocus: timeSetter) => void, setterFn: timeSetter }
type timeSetter = (time: number, o?: any) => void
type TimeExtractor<T> = (frame: T) => number
type EpsilonChecker<T> = (state: AnimationState<T>, candidateTime: number | undefined) => boolean

const timeComparison = (a: number, b: number) => a - b
// const throttleRateMs = 100


const snapTimeToGrid = (time: number, searchFn: BstSearchFn<number>) => {
    const nearestTime = searchFn(time)
    return nearestTime
}

export const useFrameMatchingTime = <T, >(state: AnimationState<T>, getTimeFromFrame: TimeExtractor<T>) => {
    const realizedTimestamps = useMemo(() => {
        return state.frameData.map(d => getTimeFromFrame(d))
    }, [state.frameData, getTimeFromFrame])
    const timeSearchFn = useBinarySearchTree<number>(realizedTimestamps, timeComparison)
    const findFrameMatchingTime = useCallback((time: number) => snapTimeToGrid(time, timeSearchFn), [timeSearchFn])
    return findFrameMatchingTime
}

export const useEpsilonChecker = <T, >(getTimeFromFrame: TimeExtractor<T>) => {
    const checker = useCallback((state: AnimationState<T>, candidateTime: number | undefined) => {
        // Base cases that should be no-ops
        if (candidateTime === undefined || state === undefined || state.frameData === undefined) return true
        if (state.frameData.length < 100) return false // always update if we have a very short data series
        const frameUpperBound = Math.min(state.frameData.length - 1, state.currentFrameIndex + 2)
        const frameLowerBound = Math.max(0, state.currentFrameIndex - 2)
        // console.log(`candidate time ${candidateTime} range (${getTimeFromFrame(state.frameData[frameLowerBound])} - ${getTimeFromFrame(state.frameData[frameUpperBound])})`)
        return !((candidateTime < getTimeFromFrame(state.frameData[frameLowerBound])) || (candidateTime > getTimeFromFrame(state.frameData[frameUpperBound])))
    }, [getTimeFromFrame])
    return checker
}

// So. This hook takes the outside setter, the inside setter, and the time lookup function.
// It returns a callback that takes state and focusTime and Does The Right Thing with them.
// The "Right Thing" is to see if the focus time is within epsilon of the time implied by current state.
// If it is, do nothing.
// If it isn't, we check our records to see whether the focus time is what we expect.
// If it is, do nothing.
// If it isn't, then it must have updated, and we set our state to that implied by the focus time.

const useSynchronizedTime = <T, >(
    setExternalTime: timeSetter,
    animationStateDispatcher: React.Dispatch<AnimationStateAction<T>>,
    getTimeFromFrame: TimeExtractor<T>,
    getFrameMatchingTime: TimeLookupFn,
    epsilonChecker: EpsilonChecker<T>
    ) => {
    const expectedFocusTime = useRef<number | undefined>(undefined)

    // This gets called when either the state or the focus updates.
    // If the state updated but the focus didn't, set to the state.
    // If the focus updated but the state didn't, set to the focus.
    // Every time we do either, we set the expected focus to that thing.
    // If the expected focus is empty, set it to the first frame.
    const callback = useCallback((state: AnimationState<T>, focusTime: number | undefined) => {
        if (state === undefined || state.frameData === undefined || focusTime === undefined) return
        // console.log(`expected focus time ${expectedFocusTime.current}`)
        // TODO: Consider removing this.
        if (epsilonChecker(state, focusTime)) {
            expectedFocusTime.current = focusTime
            return
        }
        // console.log(`Passed epsilon check: something needs to update.`)
        // The current-frame-time and the focus-time are out of sync. Need to update one or the other.
        // Look @ expectedFocusTime to determine who is right.
        if (expectedFocusTime.current === undefined) {
            expectedFocusTime.current = getTimeFromFrame(state.frameData[0])
            return
        }
        // console.log(`Expected focus time is defined.`)
        if (expectedFocusTime.current === focusTime) {
            // console.log(`Expected focus matches received focus: must be external state change.`)
            // expected focus matches received focus: state must have changed, so match to that.
            const frameTime = getTimeFromFrame(state.frameData[state.currentFrameIndex])
            expectedFocusTime.current = frameTime
            setExternalTime(frameTime, {autoScrollVisibleTimeRange: true})
        } else {
            // console.log(`Expected focus does not match received focus: update us to match them.`)
            // expected focus time does not match received focus: must have been an external focus update. Match to that.
            expectedFocusTime.current = focusTime
            const matchingIndex = getFrameMatchingTime(focusTime)?.baseListIndex
            if (matchingIndex === undefined) return
            animationStateDispatcher({
                type: 'SET_CURRENT_FRAME',
                newIndex: matchingIndex
            })
        }
    }, [epsilonChecker, getTimeFromFrame, setExternalTime, animationStateDispatcher, getFrameMatchingTime])

    return callback
}

export default useSynchronizedTime
