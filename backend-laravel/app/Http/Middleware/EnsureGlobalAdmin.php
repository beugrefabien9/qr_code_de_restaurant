<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureGlobalAdmin
{
    public function handle(Request $request, Closure $next): Response
    {
        abort_unless($request->user()?->isGlobalAdmin(), 403, 'Accès réservé à l’administrateur général.');

        return $next($request);
    }
}
