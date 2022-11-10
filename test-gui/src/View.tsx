import { loadView as loadCoreView } from '@figurl/core-views';
import { loadView as loadTimeseriesView } from '@figurl/timeseries-views';
import { loadView as loadSpikeSortingView } from '@figurl/spike-sorting-views';
import { FunctionComponent, useMemo } from 'react';
import { loadView as loadFranklabView } from './package';

type Props = {
    data: any
    opts: any
    width: number
    height: number
}

const View: FunctionComponent<Props> = ({data, width, height, opts}) => {
    // It's important to memoize this
    // because validation of data can be slow
    const v = useMemo(() => {
        const viewLoaders = [loadCoreView, loadTimeseriesView, loadSpikeSortingView, loadFranklabView]
        for (let loadView of viewLoaders) {
            const v = loadView({data, width, height, opts, ViewComponent: View})
            if (v) return v
        }
    }, [data, height, width, opts])
    if (v) return v
    
    console.warn(data)
    return (
        <div>Invalid view data: {data.type}</div>
    )
}

export default View