import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakToggle } from './components/TweaksPanel.jsx'
import DashboardView from './views/DashboardView.jsx'
import LibraryTree from './views/LibraryTree.jsx'
import LibraryGrid from './views/LibraryGrid.jsx'
import ArtView from './views/ArtView.jsx'
import SettingsView from './views/SettingsView.jsx'
import AddMusicDialog from './components/AddMusicDialog.jsx'

const TWEAK_DEFAULTS = {
  graffitiIntensity: 'medium',
  accentColor: 'spray-pink',
  showStickers: true,
  density: 'compact',
}

export default function App() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS)
  const [addMusicOpen, setAddMusicOpen] = React.useState(false)

  React.useEffect(() => {
    const r = document.documentElement
    const accentMap = { 'spray-pink': 'pink', 'acid-green': 'green', 'cyan': 'cyan' }
    r.setAttribute('data-accent', accentMap[tweaks.accentColor] || 'pink')
    r.setAttribute('data-vibe', tweaks.graffitiIntensity || 'medium')
    r.setAttribute('data-density', tweaks.density || 'compact')
  }, [tweaks])

  const openAddMusic = () => setAddMusicOpen(true)

  return (
    <>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardView onAddMusic={openAddMusic} />} />
        <Route path="/tree" element={<LibraryTree onAddMusic={openAddMusic} />} />
        <Route path="/grid" element={<LibraryGrid onAddMusic={openAddMusic} />} />
        <Route path="/art" element={<ArtView onAddMusic={openAddMusic} />} />
        <Route path="/settings" element={<SettingsView onAddMusic={openAddMusic} />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
      {addMusicOpen && <AddMusicDialog onClose={() => setAddMusicOpen(false)} />}

      <TweaksPanel title="Tweaks">
        <TweakSection label="Graffiti vibe" />
        <TweakRadio
          label="Intensity"
          value={tweaks.graffitiIntensity}
          onChange={v => setTweak('graffitiIntensity', v)}
          options={[
            { value: 'subtle', label: 'Subtle' },
            { value: 'medium', label: 'Medium' },
            { value: 'heavy', label: 'Heavy' },
          ]}
        />
        <TweakToggle
          label="Stickers & tape"
          value={tweaks.showStickers}
          onChange={v => setTweak('showStickers', v)}
        />
        <TweakSection label="Theme" />
        <TweakRadio
          label="Primary accent"
          value={tweaks.accentColor}
          onChange={v => setTweak('accentColor', v)}
          options={[
            { value: 'spray-pink', label: 'Pink' },
            { value: 'acid-green', label: 'Green' },
            { value: 'cyan', label: 'Cyan' },
          ]}
        />
        <TweakSection label="Data view" />
        <TweakRadio
          label="Row density"
          value={tweaks.density}
          onChange={v => setTweak('density', v)}
          options={[
            { value: 'compact', label: 'Compact' },
            { value: 'comfortable', label: 'Cozy' },
            { value: 'roomy', label: 'Roomy' },
          ]}
        />
      </TweaksPanel>
    </>
  )
}
