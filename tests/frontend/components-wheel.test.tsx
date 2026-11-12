import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CamelotWheel } from '../../src/camelot-wheel'
import { Empty, KeyBadge, LiveWaveform, MiniWave, Modal, Stars } from '../../src/components'

describe('components.tsx', () => {
  it('renders KeyBadge matched, unmatched and null states', () => {
    const { container, rerender } = render(<KeyBadge value={null} reference="8A" />)
    expect(container.querySelector('.muted')).toHaveTextContent('—')

    rerender(<KeyBadge value="8A" reference="9A" />)
    const matchBadge = container.querySelector('.keybadge')
    expect(matchBadge).toHaveTextContent('8A')
    expect(matchBadge).toHaveClass('match')

    rerender(<KeyBadge value="3B" reference="9A" />)
    const plainBadge = container.querySelector('.keybadge')
    expect(plainBadge).not.toHaveClass('match')

    rerender(<KeyBadge value="5A" />)
    expect(container.querySelector('.keybadge')).not.toHaveClass('match')
  })

  it('clamps Stars between 0 and 5 with accessible label', () => {
    const { rerender } = render(<Stars value={7.4} />)
    expect(screen.getByLabelText('5 von 5 Sternen')).toHaveTextContent('★★★★★')

    rerender(<Stars value={-2} />)
    expect(screen.getByLabelText('0 von 5 Sternen')).toHaveTextContent('☆☆☆☆☆')

    rerender(<Stars value={3} />)
    expect(screen.getByLabelText('3 von 5 Sternen')).toHaveTextContent('★★★☆☆')
  })

  it('renders deterministic MiniWave and LiveWaveform with sample data and synthetic fallback', () => {
    const { container, rerender } = render(<MiniWave trackId="trk-42" />)
    expect(container.querySelectorAll('svg.wfmini rect')).toHaveLength(32)

    rerender(<LiveWaveform samples={[0, 5, 18, 31, 12, 24]} seedId="trk-42" />)
    expect(screen.getByLabelText('Track-Analyse Waveform').querySelectorAll('rect').length).toBeGreaterThan(200)

    rerender(<LiveWaveform samples={[]} seedId="" />)
    expect(screen.getByLabelText('Track-Analyse Waveform').querySelectorAll('rect').length).toBeGreaterThan(200)
  })

  it('renders Empty state with default and custom icon', () => {
    const { rerender } = render(<Empty title="Leer">Beschreibung</Empty>)
    expect(screen.getByText('Leer')).toBeInTheDocument()
    expect(screen.getByText('Beschreibung')).toBeInTheDocument()

    rerender(<Empty icon={<span data-testid="custom-icon">*</span>} title="Custom" />)
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument()
  })

  it('handles Modal open/closed, backdrop click, Escape key and button actions', () => {
    const onClose = vi.fn()
    const onSave = vi.fn()

    const { rerender } = render(
      <Modal
        open={false}
        title="Dialog"
        onClose={onClose}
        actions={[{ label: 'Schließen' }]}
      >
        Inhalt
      </Modal>,
    )
    expect(screen.queryByRole('dialog')).toBeNull()

    rerender(
      <Modal
        open
        wide
        title="Dialog"
        onClose={onClose}
        actions={[
          { label: 'Abbrechen' },
          { label: 'Speichern', primary: true, disabled: false, onClick: onSave },
        ]}
      >
        <div>Inhalt</div>
      </Modal>,
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveClass('wide')

    // Click inside dialog should NOT close
    fireEvent.mouseDown(dialog)
    expect(onClose).not.toHaveBeenCalled()

    // Backdrop mouseDown closes
    fireEvent.mouseDown(dialog.parentElement!)
    expect(onClose).toHaveBeenCalledTimes(1)

    // Non-Escape key does not close
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onClose).toHaveBeenCalledTimes(1)

    // Escape closes
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)

    // Action without onClick falls back to onClose
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
    expect(onClose).toHaveBeenCalledTimes(3)

    // Action with onClick calls handler without auto-closing
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})

describe('camelot-wheel.tsx', () => {
  it('renders 24 Camelot segments, handles single/additive clicks, keyboard activation and toggles', () => {
    const onToggleKey = vi.fn()
    const onSelectAllHarmonic = vi.fn()
    const onAutoFollowChange = vi.fn()
    const onIncludeCurrentChange = vi.fn()

    const { container, rerender } = render(
      <CamelotWheel
        referenceKey="8A"
        pinned={false}
        selectedKeys={['8A', '9A', '4B']}
        autoFollow
        includeCurrent={false}
        onToggleKey={onToggleKey}
        onSelectAllHarmonic={onSelectAllHarmonic}
        onAutoFollowChange={onAutoFollowChange}
        onIncludeCurrentChange={onIncludeCurrentChange}
      />,
    )

    expect(container.querySelectorAll('g[data-wheel-key]')).toHaveLength(24)
    expect(screen.getByText('Live-Referenz')).toBeInTheDocument()
    expect(screen.getByText('8A', { selector: 'text.wheelcentertext' })).toBeInTheDocument()
    expect(screen.getByText('Aktive Keys: 8A, 9A, 4B')).toBeInTheDocument()

    // SVG geometry checks (kills all pt(), pathWedge(), angles and radius mutants in camelot-wheel.tsx)
    const allPaths = container.querySelectorAll('.wheel path')
    expect(allPaths).toHaveLength(24)

    const seg1B = container.querySelector('g[data-wheel-key="1B"]')!
    const d1B = seg1B.querySelector('path')?.getAttribute('d') ?? ''
    expect(d1B).toMatch(/^M160\.\d+ 9\.\d+ A151 151 0 0 1 234\.\d+ 28\.\d+ L216\.\d+ 60\.\d+ A114 114 0 0 0 160\.\d+ 46\.\d+Z$/)

    const seg1A = container.querySelector('g[data-wheel-key="1A"]')!
    const d1A = seg1A.querySelector('path')?.getAttribute('d') ?? ''
    expect(d1A).toMatch(/^M160\.\d+ 47\.\d+ A113 113 0 0 1 215\.\d+ 62\.\d+ L194\.\d+ 99\.\d+ A70 70 0 0 0 160\.\d+ 90\.\d+Z$/)

    const text1B = seg1B.querySelector('text')!
    expect(Number(text1B.getAttribute('x'))).toBeCloseTo(194.16, 1)
    expect(Number(text1B.getAttribute('y'))).toBeCloseTo(32.49, 1)

    const text1A = seg1A.querySelector('text')!
    expect(Number(text1A.getAttribute('x'))).toBeCloseTo(183.55, 1)
    expect(Number(text1A.getAttribute('y'))).toBeCloseTo(72.10, 1)

    // Segment <title>, aria-label, path styling and class assertions across all 4 states
    const seg8A = container.querySelector('g[data-wheel-key="8A"]')!
    expect(seg8A).toHaveAttribute('aria-label', '8A, aktuell, harmonisch kompatibel, als Filter gewählt')
    expect(seg8A.querySelector('title')?.textContent).toBe(
      '8A · Aktuelle Referenz · Aktiv im Filter – Klick: nur diesen Key · Strg+Klick: mehrfach wählen',
    )
    expect(seg8A.querySelector('path')).toHaveAttribute('fill', '#276eb8')
    expect(seg8A.querySelector('path')).toHaveAttribute('stroke', '#99c7ff')
    expect(seg8A.querySelector('path')).toHaveAttribute('stroke-width', '2')
    expect(seg8A.querySelector('text')).toHaveClass('activekey')

    const seg7A = container.querySelector('g[data-wheel-key="7A"]')!
    expect(seg7A).toHaveAttribute('aria-label', '7A, harmonisch kompatibel')
    expect(seg7A.querySelector('title')?.textContent).toBe(
      '7A · Harmonisch kompatibel – Klick: nur diesen Key · Strg+Klick: mehrfach wählen',
    )
    expect(seg7A.querySelector('path')).toHaveAttribute('fill', '#344b60')
    expect(seg7A.querySelector('path')).toHaveAttribute('stroke', '#4a535d')
    expect(seg7A.querySelector('path')).toHaveAttribute('stroke-width', '1')
    expect(seg7A.querySelector('text')).not.toHaveClass('activekey')

    const seg9A = container.querySelector('g[data-wheel-key="9A"]')!
    expect(seg9A).toHaveAttribute('aria-label', '9A, harmonisch kompatibel, als Filter gewählt')
    expect(seg9A.querySelector('title')?.textContent).toBe(
      '9A · Harmonisch kompatibel · Aktiv im Filter – Klick: nur diesen Key · Strg+Klick: mehrfach wählen',
    )
    expect(seg9A.querySelector('path')).toHaveAttribute('fill', '#315d83')
    expect(seg9A.querySelector('path')).toHaveAttribute('stroke', '#618cb5')

    const seg4B = container.querySelector('g[data-wheel-key="4B"]')!
    expect(seg4B).toHaveAttribute('aria-label', '4B, als Filter gewählt')
    expect(seg4B.querySelector('title')?.textContent).toBe(
      '4B · Aktiv im Filter – Klick: nur diesen Key · Strg+Klick: mehrfach wählen',
    )

    const seg3B = container.querySelector('g[data-wheel-key="3B"]')!
    expect(seg3B).toHaveAttribute('aria-label', '3B')
    expect(seg3B.querySelector('title')?.textContent).toBe(
      '3B – Klick: nur diesen Key · Strg+Klick: mehrfach wählen',
    )
    expect(seg3B.querySelector('path')).toHaveAttribute('fill', '#222831')
    expect(seg3B.querySelector('path')).toHaveAttribute('stroke', '#4a535d')

    const seg3A = container.querySelector('g[data-wheel-key="3A"]')!
    expect(seg3A.querySelector('path')).toHaveAttribute('fill', '#272e37')

    // Segment click (non-additive vs Ctrl/Shift/Meta-additive)
    fireEvent.click(seg8A, { ctrlKey: false, shiftKey: false, metaKey: false })
    expect(onToggleKey).toHaveBeenLastCalledWith('8A', false)

    fireEvent.click(seg8A, { ctrlKey: true })
    expect(onToggleKey).toHaveBeenLastCalledWith('8A', true)

    fireEvent.click(seg8A, { shiftKey: true })
    expect(onToggleKey).toHaveBeenLastCalledWith('8A', true)

    fireEvent.click(seg8A, { metaKey: true })
    expect(onToggleKey).toHaveBeenLastCalledWith('8A', true)

    // Keyboard activation: Enter and Space (plain = false with preventDefault)
    const enterEvt = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true })
    const preventEnter = vi.spyOn(enterEvt, 'preventDefault')
    seg8A.dispatchEvent(enterEvt)
    expect(preventEnter).toHaveBeenCalled()
    expect(onToggleKey).toHaveBeenLastCalledWith('8A', false)

    const spaceEvt = new KeyboardEvent('keydown', { key: ' ', cancelable: true, bubbles: true })
    const preventSpace = vi.spyOn(spaceEvt, 'preventDefault')
    seg8A.dispatchEvent(spaceEvt)
    expect(preventSpace).toHaveBeenCalled()
    expect(onToggleKey).toHaveBeenLastCalledWith('8A', false)

    // Keyboard activation with modifiers: Ctrl, Shift, Meta
    const enterShift = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true, bubbles: true })
    seg8A.dispatchEvent(enterShift)
    expect(onToggleKey).toHaveBeenLastCalledWith('8A', true)

    const enterCtrl = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, cancelable: true, bubbles: true })
    seg8A.dispatchEvent(enterCtrl)
    expect(onToggleKey).toHaveBeenLastCalledWith('8A', true)

    const enterMeta = new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, cancelable: true, bubbles: true })
    seg8A.dispatchEvent(enterMeta)
    expect(onToggleKey).toHaveBeenLastCalledWith('8A', true)

    const spaceCtrl = new KeyboardEvent('keydown', { key: ' ', ctrlKey: true, cancelable: true, bubbles: true })
    seg8A.dispatchEvent(spaceCtrl)
    expect(onToggleKey).toHaveBeenLastCalledWith('8A', true)

    // Ignored keys: Tab, Escape, ArrowRight, 'a' (must NOT preventDefault and must NOT trigger onToggleKey)
    const callCountBefore = onToggleKey.mock.calls.length
    for (const key of ['Tab', 'Escape', 'ArrowRight', 'a']) {
      const ignEvt = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true })
      const ignPrevent = vi.spyOn(ignEvt, 'preventDefault')
      seg8A.dispatchEvent(ignEvt)
      expect(ignPrevent).not.toHaveBeenCalled()
    }
    expect(onToggleKey.mock.calls.length).toBe(callCountBefore)

    // Quick chips: title & active/current classes + click
    const chip8A = container.querySelector('.keychip[data-key="8A"]')!
    expect(chip8A).toHaveClass('active', 'current')
    expect(chip8A.className).toBe('keychip active current')
    expect(chip8A).toHaveAttribute(
      'title',
      '8A (aktuelle Tonart) – Klick: einzeln · Strg+Klick: hinzufügen/abwählen',
    )
    const chip7A = container.querySelector('.keychip[data-key="7A"]')!
    expect(chip7A).not.toHaveClass('active')
    expect(chip7A).not.toHaveClass('current')
    expect(chip7A.className).toBe('keychip  ')
    expect(chip7A).toHaveAttribute(
      'title',
      '7A (harmonischer Nachbar) – Klick: einzeln · Strg+Klick: hinzufügen/abwählen',
    )
    const chip9A = container.querySelector('.keychip[data-key="9A"]')!
    expect(chip9A).toHaveClass('active')
    expect(chip9A).not.toHaveClass('current')
    expect(chip9A.className).toBe('keychip active ')
    expect(chip9A).toHaveAttribute(
      'title',
      '9A (harmonischer Nachbar) – Klick: einzeln · Strg+Klick: hinzufügen/abwählen',
    )
    fireEvent.click(chip9A, { ctrlKey: false, shiftKey: false, metaKey: false })
    expect(onToggleKey).toHaveBeenLastCalledWith('9A', false)

    fireEvent.click(chip9A, { ctrlKey: true })
    expect(onToggleKey).toHaveBeenLastCalledWith('9A', true)

    fireEvent.click(chip9A, { shiftKey: true })
    expect(onToggleKey).toHaveBeenLastCalledWith('9A', true)

    fireEvent.click(chip9A, { metaKey: true })
    expect(onToggleKey).toHaveBeenLastCalledWith('9A', true)

    // All harmonic button & checkboxes + their exact tooltips
    const allHarmonicBtn = screen.getByRole('button', { name: 'Alle harmonisch passenden Keys wählen' })
    expect(allHarmonicBtn).toHaveAttribute(
      'title',
      'Wählt alle 4 harmonisch passenden Camelot-Keys (-1, Referenz, +1 sowie A/B-Wechsel)',
    )
    fireEvent.click(allHarmonicBtn)
    expect(onSelectAllHarmonic).toHaveBeenCalledTimes(1)

    const autoFollowInput = container.querySelector('#autoFollow')!
    expect(autoFollowInput.closest('label.checkrow')).toHaveAttribute(
      'title',
      'Passt die gewählten kompatiblen Keys automatisch an, sobald ein neuer Track auf dem aktiven Deck läuft',
    )
    fireEvent.click(autoFollowInput)
    expect(onAutoFollowChange).toHaveBeenCalledWith(false)

    const includeCurrentInput = container.querySelector('#includeCurrent')!
    expect(includeCurrentInput.closest('label.checkrow')).toHaveAttribute(
      'title',
      'Bezieht die exakt gleiche Tonart des Referenztracks zusätzlich zu den Nachbar-Keys ein',
    )
    fireEvent.click(includeCurrentInput)
    expect(onIncludeCurrentChange).toHaveBeenCalledWith(true)

    // Pinned & empty selectedKeys state
    rerender(
      <CamelotWheel
        referenceKey="8A"
        pinned
        selectedKeys={[]}
        autoFollow={false}
        includeCurrent
        onToggleKey={onToggleKey}
        onSelectAllHarmonic={onSelectAllHarmonic}
        onAutoFollowChange={onAutoFollowChange}
        onIncludeCurrentChange={onIncludeCurrentChange}
      />,
    )
    expect(screen.getByText('Fixierte Referenz')).toBeInTheDocument()
    expect(screen.getByText('Keine Keys gewählt – klicke ein Segment')).toBeInTheDocument()
  })
})
