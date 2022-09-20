import { ViewComponentProps } from "@figurl/core-views"
import { FunctionComponent } from "react"
import { isTrackAnimationStaticData, TrackPositionAnimationView } from "./view-track-position-animation"

const loadView = (o: {data: any, width: number, height: number, opts: any, ViewComponent: FunctionComponent<ViewComponentProps>}) => {
    const {data, width, height} = o
    if (isTrackAnimationStaticData(data)) {
        return <TrackPositionAnimationView data={data} width={width} height={height} />
    }
    else return undefined
}

export default loadView