/*
 * Aturan bisnis rekrutmen: tahapan kandidat dan penilaian interview.
 *
 * Seperti logic.js, file ini dipakai server (aturan resmi) dan browser (pratinjau, supaya tombol
 * yang tidak boleh dipakai langsung menampilkan alasannya). Semua fungsi murni, tanpa database.
 *
 * Bentuk data:
 *  candidate:  { id, jobId, name, stage }
 *  job:        { id, openings, status }
 *  evaluation: { candidateId, interviewerId, stage, score, recommend }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HRRecruit = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // Urutan tahap maju. 'rejected' bisa dicapai dari tahap aktif mana pun.
  const STAGES = ['applied', 'screening', 'interview_hr', 'interview_user', 'offer', 'hired'];
  const STAGE_LABEL = {
    applied: 'Dilamar',
    screening: 'Seleksi CV',
    interview_hr: 'Interview HR',
    interview_user: 'Interview User',
    offer: 'Penawaran',
    hired: 'Diterima',
    rejected: 'Ditolak',
  };
  const INTERVIEW_STAGES = ['interview_hr', 'interview_user'];
  const MIN_AVG_SCORE = 3;

  const isFinal = (s) => s === 'hired' || s === 'rejected';
  const nextStage = (s) => STAGES[STAGES.indexOf(s) + 1] || null;
  const avgScore = (evals) => (evals.length ? evals.reduce((a, e) => a + e.score, 0) / evals.length : 0);

  /**
   * Memeriksa apakah actor boleh memindahkan kandidat ke tahap `to`.
   * Mengembalikan daftar alasan penolakan (kosong = boleh).
   * ctx: { job, evaluations (milik kandidat ini), hiredCount (jumlah diterima di lowongan ini), reason }
   *
   * Pembagian tugas: Admin HR menjalankan proses sampai Penawaran,
   * Manager HR yang memutuskan penawaran (diterima atau ditolak).
   */
  function checkMove(actor, cand, to, ctx) {
    const errors = [];
    if (!actor || !cand) return ['Data tidak lengkap.'];
    if (isFinal(cand.stage)) return ['Kandidat sudah berstatus final.'];
    const evals = ctx.evaluations || [];

    if (to === 'rejected') {
      if (String(ctx.reason || '').trim().length < 3) errors.push('Alasan penolakan wajib diisi.');
      const deciderRole = cand.stage === 'offer' ? 'hr_manager' : 'admin';
      if (actor.role !== deciderRole) {
        errors.push(cand.stage === 'offer'
          ? 'Penawaran hanya bisa diputuskan oleh Manager HR.'
          : 'Hanya Admin HR yang dapat menolak kandidat.');
      }
      return errors;
    }

    if (to !== nextStage(cand.stage)) return ['Tahapan harus berurutan, tidak boleh dilompati.'];
    if (ctx.job && ctx.job.status === 'closed') errors.push('Lowongan sudah ditutup.');

    if (to === 'hired') {
      if (actor.role !== 'hr_manager') errors.push('Hanya Manager HR yang dapat menyetujui penawaran.');
      if (ctx.job && (ctx.hiredCount || 0) >= ctx.job.openings) errors.push('Kuota lowongan sudah terpenuhi.');
      return errors;
    }

    if (actor.role !== 'admin') errors.push('Hanya Admin HR yang dapat memindahkan tahap kandidat.');

    if (to === 'interview_user' && !evals.some((e) => e.stage === 'interview_hr' && e.recommend === 'lanjut')) {
      errors.push('Butuh minimal satu penilaian Interview HR dengan rekomendasi "lanjut".');
    }
    if (to === 'offer') {
      if (!evals.some((e) => e.stage === 'interview_user')) errors.push('Butuh minimal satu penilaian dari Interview User.');
      const avg = avgScore(evals);
      if (evals.length && avg < MIN_AVG_SCORE) {
        errors.push(`Rata-rata skor penilaian ${avg.toFixed(1)} masih di bawah ${MIN_AVG_SCORE}.`);
      }
    }
    return errors;
  }

  /**
   * Memeriksa penilaian interview. Admin HR yang mengisi, atas nama pewawancara
   * (interviewerId). Pewawancara harus tercatat di jadwal interview kandidat itu,
   * pada tahap interview yang sedang berjalan, dan satu orang hanya satu penilaian per tahap.
   * interviewerIds: id pewawancara pada jadwal interview kandidat ini.
   */
  function checkEvaluation(actor, cand, input, evals, interviewerIds) {
    if (!actor || actor.role !== 'admin') return ['Hanya Admin HR yang dapat mengisi penilaian.'];
    if (!INTERVIEW_STAGES.includes(cand.stage)) return ['Penilaian hanya bisa diisi saat kandidat berada di tahap interview.'];
    const errors = [];
    if (!interviewerIds.includes(input.interviewerId)) {
      errors.push('Pewawancara harus salah satu yang tercatat di jadwal interview kandidat ini.');
    } else if (evals.some((e) => e.interviewerId === input.interviewerId && e.stage === cand.stage)) {
      errors.push('Pewawancara ini sudah dinilai pada tahap ini.');
    }
    if (!Number.isInteger(input.score) || input.score < 1 || input.score > 5) errors.push('Skor harus bilangan 1 sampai 5.');
    if (!['lanjut', 'tidak'].includes(input.recommend)) errors.push('Pilih rekomendasi: lanjut atau tidak.');
    return errors;
  }

  return { STAGES, STAGE_LABEL, INTERVIEW_STAGES, MIN_AVG_SCORE, isFinal, nextStage, avgScore, checkMove, checkEvaluation };
});
