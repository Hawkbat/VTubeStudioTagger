import React, { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { ApiClient, Plugin, WebSocketBus } from 'vtubestudio'
import { BufferedWebsocket } from './utils'
import { ArtMeshToTagsMap, buildUserDataFile, getArtMeshToTagsMap, UserDataFile } from './userData'

const TOKEN_KEY = 'vtstudio-tagger-token'
const FILTER_KEY = 'vtstudio-tagger-filter'

function App() {
  const [vtsPort, setVtsPort] = useState(8001)
  const [filter, setFilter] = useState(() => localStorage.getItem(FILTER_KEY) ?? '')

  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const [highlightColor, setHighlightColor] = useState('magenta')
  const [modelName, setModelName] = useState<string>('')
  const [artMeshes, setArtMeshes] = useState<string[] | null>(null)
  const [tags, setTags] = useState<string[] | null>(null)
  const [originalArtMeshMap, setOriginalArtMeshMap] = useState<ArtMeshToTagsMap | null>(null)
  const [artMeshesToTags, setArtMeshesToTags] = useState<ArtMeshToTagsMap | null>(null)

  const filterRef = useRef<HTMLInputElement>(null)

  const { plugin, ws } = useMemo(() => {
    const ws = new BufferedWebsocket(`ws://localhost:8001`)
    const bus = new WebSocketBus(ws)
    const client = new ApiClient(bus)
    const initialToken = localStorage.getItem(TOKEN_KEY) ?? undefined
    const plugin = new Plugin(client, 'ArtMesh Tagger', 'Hawkbar', undefined, initialToken, token => localStorage.setItem(TOKEN_KEY, token))
    ws.addEventListener('open', () => setConnected(true))
    ws.addEventListener('close', () => setConnected(false))

    return { plugin, ws }
  }, [])

  useEffect(() => {
    ws.url = `ws://localhost:${vtsPort}`
  }, [ws, vtsPort])

  useEffect(() => {
    const handle = setInterval(async () => {
      if (connected) {
        try {
          const { modelLoaded, live2DModelName } = await plugin.apiClient.currentModel()
          if (modelLoaded) {
            const newModelName = live2DModelName.substr(0, live2DModelName.indexOf('.model3.json'))
            if (newModelName !== modelName) {
              setOriginalArtMeshMap(null)
              setArtMeshesToTags(null)
            }
            setModelName(newModelName)
            const { artMeshNames, artMeshTags } = await plugin.apiClient.artMeshList()
            setArtMeshes(artMeshNames)
            setTags(artMeshTags)
          } else {
            setModelName('')
            setArtMeshes([])
            setTags([])
          }
        } catch (e) {
          console.error(e)
          setError('' + e)
        }
      }
    }, 1000)
    return () => clearInterval(handle)
  }, [plugin, connected, modelName])

  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.key.length === 1) {
        if (filterRef.current) filterRef.current.focus()
        setFilter(filter => filter + e.key)
      } else if (e.key === 'Backspace') {
        if (filterRef.current) filterRef.current.focus()
        setFilter(filter => filter.substr(0, filter.length - 1))
      }
    }

    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  const hasChanges = useMemo(() => {
    if (originalArtMeshMap === null && artMeshesToTags === null) return false
    const compare = (a: ArtMeshToTagsMap, b: ArtMeshToTagsMap) => {
      for (const key in a) {
        if (!b[key]) return true
        for (const tag of a[key]) {
          if (!b[key].includes(tag)) return true
        }
      }
      for (const key in b) {
        if (!a[key]) return true
        for (const tag of b[key]) {
          if (!a[key].includes(tag)) return true
        }
      }
      return false
    }
    return compare(originalArtMeshMap ?? {}, artMeshesToTags ?? {})
  }, [originalArtMeshMap, artMeshesToTags])

  useEffect(() => {
    const listener = () => {
      if (!hasChanges) return
      return 'You have unsaved changes. You will need to download and place the userdata3.json file in your model folder to update the tags. Are you sure you want to leave without saving?'
    }
    window.addEventListener('beforeunload', listener)
    return () => window.removeEventListener('beforeunload', listener)
  }, [hasChanges])

  const changeFilter = (filter: string) => {
    localStorage.setItem(FILTER_KEY, filter)
    setFilter(filter)
  }

  const uploadUserDataFile = async (file: File | null | undefined) => {
    if (!file) return
    try {
      const userDataFile = JSON.parse(await file.text()) as UserDataFile
      const artMeshesToTags = getArtMeshToTagsMap(userDataFile)
      setArtMeshesToTags(artMeshesToTags)
      setOriginalArtMeshMap(JSON.parse(JSON.stringify(artMeshesToTags)))
    } catch (e) {
      console.error(e)
      alert('Could not process the uploaded UserData')
    }
  }

  const exportUserDataFile = async () => {
    const userDataFile = buildUserDataFile(artMeshesToTags ?? {})
    const a = document.createElement('a')
    a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(userDataFile))
    a.download = `${modelName}.userdata3.json`
    a.hidden = true
    document.body.append(a)
    a.click()
    setOriginalArtMeshMap(JSON.parse(JSON.stringify(artMeshesToTags)))
  }

  const pulseArtMeshTint = async (artMesh: string) => {
    try {
      const highlightColors: Record<string, { colorR: number, colorG: number, colorB: number, colorA: number }> = {
        transparent: { colorR: 127, colorG: 127, colorB: 127, colorA: 191 },
        cyan: { colorR: 0, colorG: 255, colorB: 255, colorA: 255 },
        magenta: { colorR: 255, colorG: 0, colorB: 255, colorA: 255 },
        yellow: { colorR: 255, colorG: 255, colorB: 0, colorA: 255 },
      }
      await plugin.apiClient.colorTint({ colorTint: highlightColors[highlightColor], artMeshMatcher: { tintAll: false, nameExact: [artMesh] } })
    } catch (e) {
      console.error(e)
      setError('' + e)
    }
  }

  const resetArtMeshTint = async (artMesh: string) => {
    try {
      await plugin.apiClient.colorTint({ colorTint: { colorR: 255, colorG: 255, colorB: 255, colorA: 255 }, artMeshMatcher: { tintAll: false, nameExact: [artMesh] } })
    } catch (e) {
      console.error(e)
      setError('' + e)
    }
  }
  const addTag = (artMesh: string, tag: string) => {
    if (!tag || artMeshesToTags?.[artMesh]?.includes(tag)) return
    setArtMeshesToTags({ ...artMeshesToTags, [artMesh]: [...(artMeshesToTags?.[artMesh] ?? []), tag] })
  }

  const removeTag = (artMesh: string, tag: string) => {
    if (!tag || !artMeshesToTags || !artMeshesToTags[artMesh] || !artMeshesToTags[artMesh].includes(tag)) return
    const last = artMeshesToTags[artMesh].length === 1
    const obj = { ...artMeshesToTags }
    if (last) delete obj[artMesh]
    else obj[artMesh] = obj[artMesh].filter(t => t !== tag)
    setArtMeshesToTags(obj)
  }

  const filteredArtMeshes = filter ? artMeshes?.filter(p => p.toLowerCase().includes(filter.toLowerCase())) ?? [] : artMeshes ?? []

  const sortedArtMeshes = [...filteredArtMeshes].sort()

  const needsUserDataFile = tags && tags.length > 0 && !artMeshesToTags

  return (
    <div className="App">
      {!connected ? <>
        <label>VTube Studio API Port:&nbsp;<input type="number" value={vtsPort} onChange={e => setVtsPort(e.target.valueAsNumber)} /></label>
        <br />
      </> : null}
      {connected && !error ? <>
        {needsUserDataFile ? <>
          <div>The currently loaded model has existing tags but no UserData file has been loaded. Please select the model's userdata3.json file:</div>
          <input type="file" onChange={e => uploadUserDataFile(e.target.files?.[0])} />
          <br />
        </> : null}
        {tags && !tags.length && !artMeshesToTags ? <>
          <div>The currently loaded model has no existing tags. A new UserData file will be generated when you start adding tags, or you can upload your existing userdata3.json file:</div>
          <input type="file" onChange={e => uploadUserDataFile(e.target.files?.[0])} />
          <br />
        </> : null}
        {hasChanges ? <>
          <div>To save your changes, download the updated userdata3.json file and place it next to the model3.json file in your model's folder in VTube Studio:</div>
          <button onClick={() => exportUserDataFile()}>Download userdata3.json</button>
        </> : <>
          <div>You have no unsaved changes.</div>
        </>}
        {artMeshes && artMeshes.length ? <>
          <br />
          <i>Note: Hovering over the art mesh names will highlight them in VTube Studio. Highlight color:&nbsp;<select value={highlightColor} onChange={e => setHighlightColor(e.target.value)}>
            <option>transparent</option>
            <option>cyan</option>
            <option>magenta</option>
            <option>yellow</option>
          </select></i>
        </> : null}
        <h3>{modelName}</h3>
        <label>Filter:&nbsp;<input ref={filterRef} type="text" defaultValue={filter} onChange={e => changeFilter(e.target.value)} /></label>
        <br />
      </> : null}
      {connected && !error ? <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr' }}>
        <label>ArtMesh Name</label>
        <label>Tags</label>
        {sortedArtMeshes ? sortedArtMeshes.map((artMesh, i) => <Fragment key={artMesh + i}>
          <div className="artmeshName" onMouseEnter={() => pulseArtMeshTint(artMesh)} onMouseLeave={() => resetArtMeshTint(artMesh)}>{artMesh}</div>
          <div className="artmeshTags" onMouseEnter={() => pulseArtMeshTint(artMesh)} onMouseLeave={() => resetArtMeshTint(artMesh)}>
            {!needsUserDataFile ? <input type="text" placeholder="New tag..."
              onKeyDown={e => {
                e.stopPropagation()
                if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
                  addTag(artMesh, e.target.value)
                  e.target.value = ''
                }
              }}
              onBlur={e => {
                addTag(artMesh, e.target.value)
                e.target.value = ''
              }} /> : null}
            {artMeshesToTags?.[artMesh]?.map(t => <div key={t} className="tag" onClick={() => removeTag(artMesh, t)}><span>{t}</span><div>&times;</div></div>)}
          </div>
        </Fragment>) : <i>No model is currently loaded. Load a model to view the list of artmeshes and tags.</i>}
      </div> : <i title={error}>Not connected to VTube Studio. Ensure that you are running the latest version of VTube Studio on the same device as this webpage and that the port matches in the settings.</i>
      }
      <i>If you are experiencing connection issues with VTube Studio, try refreshing the page.</i>
    </div>
  )
}

export default App
